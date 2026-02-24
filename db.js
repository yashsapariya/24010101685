'use strict';
const sql = require('mssql');
require('dotenv').config();

const config =
{
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_DATABASE || 'SupportTicketDB',
  port: parseInt(process.env.DB_PORT, 10) || 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    instanceName: process.env.DB_INSTANCE || undefined,
  },
};

if (process.env.DB_WINDOWS_AUTH === 'true') {
  config.options.trustedConnection = true;
} 
else
  {
  config.user = process.env.DB_USER || 'sa';
  config.password = process.env.DB_PASSWORD || '';
}

let pool = null;

async function getPool()
{
  if (pool) return pool;
  pool = await sql.connect(config);
  return pool;
}

module.exports = { getPool, sql };
