FROM node:22-alpine

WORKDIR /app

# Pin pnpm to exact version matching lockfile
RUN npm install -g pnpm@10.4.1

# Copy package manifest, lockfile, AND patches directory before install
# pnpm reads patchedDependencies from package.json during install and needs
# the patch files to be present at that point
COPY package.json ./
COPY patches/ ./patches/

# Install dependencies (lockfile is consistent with package.json config)
RUN pnpm install --no-frozen-lockfile


# Copy remaining source code
COPY . .

# Build the project
RUN pnpm build

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]
