'use strict';
/**
 * SEVA MARKET INDIA — production entrypoint.
 *
 * Bootstraps the durable database (see bootstrap-db.cjs) and then starts the
 * web server. All deploy targets (Dockerfile, Render, Railway, Procfile) point
 * here so the database is always initialised before the listener opens.
 */

require('./bootstrap-db.cjs')();
require('../server');
