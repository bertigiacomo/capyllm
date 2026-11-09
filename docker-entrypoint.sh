#!/bin/sh
set -e

# Ensure /data directory exists and has proper permissions for SQLite
mkdir -p /data
chmod 777 /data

# Run Drizzle native migrations automatically on deployment
bun run db:migrate

exec "$@"
