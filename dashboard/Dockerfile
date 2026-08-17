# --- build stage ---
FROM node:20-alpine AS build

WORKDIR /app

# Vite env vars are inlined into the bundle at build time. The load balancer
# is reached from the *browser*, not from inside the Docker network, so this
# should stay the host-mapped URL (http://localhost:8080) - not a container
# name, which the browser could never resolve.
ARG VITE_LB_URL=http://localhost:8080
ENV VITE_LB_URL=${VITE_LB_URL}

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- serve stage ---
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget --spider -q http://localhost:80/ || exit 1
