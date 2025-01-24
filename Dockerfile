# Generated by https://smithery.ai. See: https://smithery.ai/docs/config#dockerfile
# Use a Node.js image for building the project
FROM node:20-alpine AS builder

# Set the working directory inside the container
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN --mount=type=cache,target=/root/.npm npm install

# Copy the rest of the project files
COPY src ./src
COPY tsconfig.json ./

# Build the project
RUN npm run build

# Use a smaller Node.js image for the runtime
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy only the necessary files for running the application
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copy an entrypoint script to handle environment variable logic
COPY ./docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Define the entrypoint script
ENTRYPOINT ["/app/docker-entrypoint.sh"]
