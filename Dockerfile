FROM node:8-slim

# Add a non-privileged user for installing and running Janitor.
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid 10001 --home /app --create-home app
WORKDIR /app

COPY . .

USER app

CMD ["npm", "start"]
