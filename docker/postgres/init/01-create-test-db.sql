-- Runs only when the postgres volume is first initialised. The be e2e globalSetup
-- also creates the database when missing, so existing volumes work too.
SELECT 'CREATE DATABASE agent_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agent_test')\gexec
