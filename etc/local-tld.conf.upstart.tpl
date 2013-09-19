# local-tld

description "local-tld"

start on runlevel [2345]
stop on runlevel [!2345]

respawn
console output

env LOCAL_TLD_CONF={{ CONFIG_FILE }}

exec {{ NODE_BIN }} {{ SERVICE_FILE }}
