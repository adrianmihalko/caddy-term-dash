FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install --production

# Bundle app source
COPY . .

# Expose port
EXPOSE 3000

# Define environment variable for Caddyfile path (can be overridden)
ENV CADDYFILE_PATH=/etc/caddy/Caddyfile

# Start the server
CMD [ "node", "server.js" ]
