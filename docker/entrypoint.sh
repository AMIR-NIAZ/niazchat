#!/bin/sh
# Runs pending TypeORM migrations, then starts the NestJS application.
set -e

echo "[entrypoint] running database migrations..."
node ./node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js

echo "[entrypoint] starting application..."
exec node dist/main.js
