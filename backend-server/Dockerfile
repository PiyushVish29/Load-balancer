# Backend server image - one image, three containers (backend-1/2/3), each
# given its identity via the SERVER_ID/PORT env vars server.js already reads.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

ENV PORT=3001
EXPOSE 3001

# alpine ships wget (via busybox) so this needs no extra install. Shell form
# so ${PORT} expands to whichever port this particular container was given.
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD wget --spider -q http://localhost:${PORT}/health || exit 1

CMD ["node", "server.js"]
