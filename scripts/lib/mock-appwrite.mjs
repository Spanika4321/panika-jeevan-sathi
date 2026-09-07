/**
 * Local stand-in for the Appwrite Cloud REST API (classic Databases service:
 * collections / attributes / indexes / documents).
 *
 * Speaks the same HTTP contract used by lib/appwrite.js so the whole site can
 * be exercised end to end — register, profile, photo upload, messages, admin,
 * restart — against the exact code paths that run on Render, without touching
 * the real Appwrite Cloud project.
 *
 * Behaviour notes:
 *   • documents live in insertion order; limit/cursorAfter pagination works
 *     like the real service for sequential numeric $ids;
 *   • attribute validation is enforced (writing an undeclared attribute or a
 *     non-matching type fails with 400), which keeps the mock honest;
 *   • failNext(n, 'http500') injects outages for the retry tests.
 */

import http from 'node:http';

function send(res, status, json) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(json));
}

export function createAppwriteMock(options = {}) {
  const projectId = options.project || 'test-project';
  const token = options.token || 'test-key';
  const collections = new Map(); // name → { attributes: Map, indexes: [], docs: [] }
  let failNext = 0;
  let failureMode = 'http500';
  const requests = [];
  const calls = {};

  function collection(name) {
    if (!collections.has(name)) {
      collections.set(name, { attributes: new Map(), indexes: [], docs: [] });
    }
    return collections.get(name);
  }

  function bump(method, name) {
    requests.push({ method, name });
    calls[name] = (calls[name] || 0) + 1;
  }

  function docJson(coll, doc) {
    return {
      $id: doc.$id,
      $collectionId: coll.name,
      $databaseId: coll.name,
      $createdAt: doc.$createdAt,
      $updatedAt: doc.$updatedAt,
      $permissions: [],
      ...doc.data
    };
  }

  function typeName(kind) {
    return kind === 'integer' ? 'integer' : 'string';
  }

  const server = http.createServer((req, res) => {
    const parts = decodeURIComponent(req.url.split('?')[0]).split('/').filter(Boolean);
    const qs = new URL(req.url, 'http://x').searchParams;
    const queries = qs.getAll('queries[]');
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      let payload = {};
      if (body) {
        try {
          payload = JSON.parse(body);
        } catch (_) {
          return send(res, 400, { message: 'invalid JSON', type: 'general_argument_invalid' });
        }
      }
      if (req.headers['x-appwrite-project'] !== projectId || req.headers['x-appwrite-key'] !== token) {
        return send(res, 401, { message: 'Invalid API key', type: 'general_unauthorized_scope' });
      }

      if (failNext > 0) {
        failNext -= 1;
        if (failureMode === 'http500') {
          return send(res, 500, { message: 'internal server error (mock)', type: 'general_internal_server_error' });
        }
        return send(res, 429, { message: 'too many requests (mock)', type: 'general_rate_limit_exceeded' });
      }

      const dbIdx = parts.indexOf('databases');
      const collIdx = parts.indexOf('collections');
      const isDb = dbIdx !== -1 && dbIdx + 1 < parts.length && parts[dbIdx + 1] !== 'transactions';
      const isColl = isDb && collIdx !== -1 && collIdx + 1 < parts.length;
      const isIndex = parts.indexOf('indexes') !== -1;
      const attrIdx = parts.indexOf('attributes');
      const table = isColl ? parts[collIdx + 1] : null;
      const docIdx = parts.indexOf('documents');

      const method = req.method;
      const coll = table && method !== 'POST' ? collection(table) : null;

      // GET/POST collection metadata (incl. attributes inside the response)
      if (method === 'GET' && isColl && docIdx === -1 && !isIndex && attrIdx === -1) {
        bump('getCollection', table);
        const c = collections.get(table);
        if (!c) return send(res, 404, { message: `Collection not found: ${table}`, type: 'collection_not_found' });
        return send(res, 200, {
          $id: table,
          name: table,
          attributes: [...c.attributes.values()].map((a) => ({
            key: a.key,
            type: a.type,
            size: a.size,
            required: false,
            status: a.status,
            error: a.error || null
          })),
          indexes: c.indexes,
          documentSecurity: false
        });
      }

      if (method === 'POST' && isDb && !isColl) {
        const name = payload.collectionId !== undefined ? payload.collectionId : payload.name;
        bump('createCollection', name || '');
        if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/.test(String(name))) {
          return send(res, 400, { message: 'Invalid collection id', type: 'collection_invalid_id' });
        }
        if (collections.has(name)) {
          return send(res, 409, { message: 'Collection already exists', type: 'collection_already_exists' });
        }
        collection(name);
        return send(res, 202, { $id: name, name: payload.name || name, attributes: [], indexes: [] });
      }

      // attributes
      if (isColl && attrIdx !== -1 && parts[attrIdx + 1]) {
        const attrType = parts[attrIdx + 1]; // string | integer
        const c = collection(table);
        if (method === 'GET') {
          bump('getAttributes', table);
          return send(res, 200, {
            attributes: [...c.attributes.values()].map((a) => ({
              key: a.key, type: a.type, size: a.size, required: false,
              status: a.status, error: a.error || null, $createdAt: a.$createdAt
            }))
          });
        }
        const key = payload.key;
        if (!key || c.attributes.has(key)) {
          return send(res, 409, { message: 'Attribute already exists', type: 'attribute_already_exists' });
        }
        const size = Number(payload.xsize !== undefined ? payload.xsize : payload.size || (attrType === 'string' ? 255 : undefined));
        if (attrType === 'string' && (!Number.isFinite(size) || size < 1 || size > 16384)) {
          return send(res, 400, { message: 'Invalid attribute size', type: 'attribute_invalid_size' });
        }
        c.attributes.set(key, { key, type: typeName(attrType), size, status: 'available', $createdAt: new Date().toISOString() });
        bump('createAttribute', `${table}.${key}`);
        return send(res, 202, {
          key, type: typeName(attrType), size, required: false, array: false,
          status: 'available', $createdAt: c.attributes.get(key).$createdAt
        });
      }

      // indexes
      if (isColl && isIndex && method === 'POST') {
        const c = collection(table);
        const key = payload.key;
        if (c.indexes.some((i) => i.key === key)) {
          return send(res, 409, { message: 'Index already exists', type: 'index_already_exists' });
        }
        const index = {
          key,
          type: payload.type || 'key',
          attributes: payload.attributes || [],
          orders: payload.orders || payload.xorders || ['ASC'],
          status: 'available'
        };
        c.indexes.push(index);
        bump('createIndex', `${table}.${key}`);
        return send(res, 202, index);
      }

      // documents
      const c = isColl && docIdx !== -1 ? collection(table) : null;
      if (c && method === 'GET') {
        bump('listDocuments', table);
        let docs = c.docs;
        let limit = 25;
        let cursor = null;
        for (const q of queries) {
          const m = /^limit\((\d+)\)$/.exec(q);
          if (m) limit = Number(m[1]);
          const c2 = /^cursorAfter\("([^"]+)"\)$/.exec(q);
          if (c2) cursor = c2[1];
        }
        let start = 0;
        if (cursor !== null) {
          const at = docs.findIndex((d) => d.$id === cursor);
          start = at === -1 ? docs.length : at + 1;
        }
        docs = docs.slice(start, start + limit);
        return send(res, 200, { total: c.docs.length, documents: docs.map((d) => docJson({ name: table }, d)) });
      }

      if (c && method === 'POST') {
        bump('createDocument', table);
        const id = payload.documentId;
        if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/.test(String(id))) {
          return send(res, 400, { message: 'Invalid documentId', type: 'document_invalid_id' });
        }
        if (c.docs.some((d) => d.$id === id)) {
          return send(res, 409, { message: 'Document already exists', type: 'document_already_exists' });
        }
        const data = payload.data || {};
        for (const [k, v] of Object.entries(data)) {
          const attr = c.attributes.get(k);
          if (!attr) return send(res, 400, { message: `Unknown attribute: ${k}`, type: 'attribute_unknown' });
          if (attr.type === 'integer' && (v !== null && (typeof v !== 'number' || !Number.isFinite(v)))) {
            if (typeof v !== 'string' || !/^-?\d+$/.test(v)) {
              return send(res, 400, { message: `Attribute ${k} must be an integer`, type: 'attribute_invalid_value' });
            }
          }
        }
        const now = new Date().toISOString();
        const doc = { $id: String(id), data, $createdAt: now, $updatedAt: now };
        c.docs.push(doc);
        return send(res, 201, docJson({ name: table }, doc));
      }

      if (c && docIdx !== -1 && parts[docIdx + 1] && method === 'PATCH') {
        bump('updateDocument', table);
        const id = parts[docIdx + 1];
        const doc = c.docs.find((d) => d.$id === id);
        if (!doc) return send(res, 404, { message: 'Document not found', type: 'document_not_found' });
        const data = payload.data || {};
        for (const [k, v] of Object.entries(data)) {
          const attr = c.attributes.get(k);
          if (!attr) return send(res, 400, { message: `Unknown attribute: ${k}`, type: 'attribute_unknown' });
          if (attr.type === 'integer' && v !== null && typeof v !== 'number') {
            return send(res, 400, { message: `Attribute ${k} must be an integer`, type: 'attribute_invalid_value' });
          }
        }
        for (const [k, v] of Object.entries(data)) doc.data[k] = v;
        doc.$updatedAt = new Date().toISOString();
        return send(res, 200, docJson({ name: table }, doc));
      }

      if (c && docIdx !== -1 && parts[docIdx + 1] && method === 'DELETE') {
        bump('deleteDocument', table);
        const id = parts[docIdx + 1];
        const at = c.docs.findIndex((d) => d.$id === id);
        if (at === -1) return send(res, 404, { message: 'Document not found', type: 'document_not_found' });
        c.docs.splice(at, 1);
        res.writeHead(204);
        res.end();
        return undefined;
      }

      return send(res, 404, { message: 'Not found', type: 'general_not_found' });
    });
  });

  return {
    server,
    listen() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/v1`));
      });
    },
    close() {
      server.close();
    },
    failNext(count = 1, mode = 'http500') {
      failNext = count;
      failureMode = mode;
    },
    get requests() {
      return requests.slice();
    },
    counts() {
      return { ...calls };
    },
    collectionDocs(name) {
      const c = collections.get(name);
      if (!c) return [];
      return c.docs.map((d) => docJson({ name }, d));
    },
    documentCount(name) {
      const c = collections.get(name);
      return c ? c.docs.length : 0;
    },
    hasCollection(name) {
      return collections.has(name);
    }
  };
}
