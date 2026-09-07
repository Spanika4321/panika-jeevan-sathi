'use strict';
/**
 * Local stand-in for the Appwrite Cloud REST API (collections/attributes/
 * documents) — speaks the same HTTP contract as src/db/appwrite.js so the
 * whole mirror pipeline can be tested offline.
 */

const http = require('node:http');

function send(res, status, json) {
  if (status === 204) {
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(json));
}

function createAppwriteMock(options = {}) {
  const projectId = options.project || 'test-project';
  const token = options.token || 'test-key';
  const collections = new Map();
  const requests = [];
  let failNext = 0;

  function collection(name) {
    if (!collections.has(name)) collections.set(name, { attributes: new Map(), docs: [] });
    return collections.get(name);
  }

  function docJson(collName, doc) {
    return {
      $id: doc.$id,
      $collectionId: collName,
      $databaseId: collName,
      $createdAt: doc.$createdAt,
      $updatedAt: doc.$updatedAt,
      $permissions: [],
      ...doc.data,
    };
  }

  const server = http.createServer((req, res) => {
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
      if (
        req.headers['x-appwrite-project'] !== projectId ||
        req.headers['x-appwrite-key'] !== token
      ) {
        return send(res, 401, { message: 'Invalid API key', type: 'general_unauthorized_scope' });
      }

      if (failNext > 0) {
        failNext -= 1;
        return send(res, 500, { message: 'internal error (mock)', type: 'general_internal_server_error' });
      }

      const url = new URL(req.url, 'http://mock');
      const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
      const dbIdx = parts.indexOf('databases');
      const collIdx = parts.indexOf('collections');
      const attrIdx = parts.indexOf('attributes');
      const docIdx = parts.indexOf('documents');
      const isDb = dbIdx !== -1 && dbIdx + 1 < parts.length;
      const isColl = isDb && collIdx !== -1 && collIdx + 1 < parts.length;
      const table = isColl ? parts[collIdx + 1] : null;
      const method = req.method;
      requests.push({ method, path: req.url });

      // create collection
      if (method === 'POST' && isDb && !isColl) {
        const name = payload.collectionId;
        if (!name) return send(res, 400, { message: 'missing collectionId', type: 'collection_invalid_id' });
        if (collections.has(name)) return send(res, 409, { message: 'exists', type: 'collection_already_exists' });
        collection(name);
        return send(res, 202, { $id: name, name, attributes: [], indexes: [] });
      }

      // get collection (metadata, incl. attributes)
      if (method === 'GET' && isColl && docIdx === -1 && attrIdx === -1) {
        const c = collections.get(table);
        if (!c) return send(res, 404, { message: 'not found', type: 'collection_not_found' });
        return send(res, 200, {
          $id: table,
          name: table,
          attributes: [...c.attributes.values()].map((a) => ({ key: a.key, status: 'available' })),
          indexes: [],
          documentSecurity: false,
        });
      }

      // create string attribute
      if (method === 'POST' && isColl && attrIdx !== -1 && parts[attrIdx + 1] === 'string') {
        const c = collection(table);
        const key = payload.key;
        if (c.attributes.has(key)) return send(res, 409, { message: 'exists', type: 'attribute_already_exists' });
        c.attributes.set(key, { key, status: 'available' });
        return send(res, 202, { key, type: 'string', status: 'available', required: false });
      }

      // list documents
      if (method === 'GET' && isColl && docIdx !== -1) {
        const c = collection(table);
        const queries = url.searchParams.getAll('queries[]');
        let limit = 25;
        let cursor = null;
        for (const q of queries) {
          const m = /^limit\((\d+)\)$/.exec(q);
          if (m) limit = Number(m[1]);
          const c2 = /^cursorAfter\("([^"]+)"\)$/.exec(q);
          if (c2) cursor = c2[1];
        }
        let docs = c.docs;
        if (cursor !== null) {
          const at = docs.findIndex((d) => d.$id === cursor);
          docs = at === -1 ? [] : docs.slice(at + 1);
        }
        docs = docs.slice(0, limit);
        return send(res, 200, { total: c.docs.length, documents: docs.map((d) => docJson(table, d)) });
      }

      // create document
      if (method === 'POST' && isColl && docIdx !== -1) {
        const c = collection(table);
        const id = payload.documentId;
        if (!id) return send(res, 400, { message: 'missing documentId', type: 'document_invalid_id' });
        if (c.docs.some((d) => d.$id === id)) return send(res, 409, { message: 'exists', type: 'document_already_exists' });
        const now = new Date().toISOString();
        const doc = { $id: String(id), data: payload.data || {}, $createdAt: now, $updatedAt: now };
        c.docs.push(doc);
        return send(res, 201, docJson(table, doc));
      }

      // update document
      if (method === 'PATCH' && isColl && docIdx !== -1 && parts[docIdx + 1]) {
        const c = collection(table);
        const id = parts[docIdx + 1];
        const doc = c.docs.find((d) => d.$id === id);
        if (!doc) return send(res, 404, { message: 'not found', type: 'document_not_found' });
        Object.assign(doc.data, payload.data || {});
        doc.$updatedAt = new Date().toISOString();
        return send(res, 200, docJson(table, doc));
      }

      // delete document
      if (method === 'DELETE' && isColl && docIdx !== -1 && parts[docIdx + 1]) {
        const c = collection(table);
        const id = parts[docIdx + 1];
        const at = c.docs.findIndex((d) => d.$id === id);
        if (at === -1) return send(res, 404, { message: 'not found', type: 'document_not_found' });
        c.docs.splice(at, 1);
        return send(res, 204);
      }

      return send(res, 404, { message: 'not found', type: 'general_not_found' });
    });
  });

  return {
    server,
    listen() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () =>
          resolve(`http://127.0.0.1:${server.address().port}/v1`),
        );
      });
    },
    close() {
      server.close();
    },
    failNext(count = 1) {
      failNext = count;
    },
    docs(table) {
      const c = collections.get(table);
      return c ? c.docs.map((d) => docJson(table, d)) : [];
    },
    docCount(table) {
      const c = collections.get(table);
      return c ? c.docs.length : 0;
    },
    get requests() {
      return requests.slice();
    },
  };
}

module.exports = { createAppwriteMock };
