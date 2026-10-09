#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$BAYLINE_DB_PASSWORD" <<'SQL'
CREATE ROLE bayline LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
ALTER DATABASE bayline OWNER TO bayline;
GRANT ALL ON SCHEMA public TO bayline;
SQL
