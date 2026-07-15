proxy_pass http://shibei_app;
proxy_http_version 1.1;
proxy_buffering off;

proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
# This is the sole ingress proxy. Replace, rather than append to, any
# caller-supplied forwarding chain so TRUST_PROXY_HOPS=1 is auditable.
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
