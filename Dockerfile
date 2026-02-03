FROM debian:stable-slim AS splat
RUN apt update && apt install -y cmake make clang zlib1g-dev libbz2-dev git && rm -rf /var/lib/apt/lists/*

COPY splat/ /splat/

WORKDIR /splat/build/
RUN cmake .. && make
RUN ln -sf splat splat-hd

WORKDIR /splat/utils/build/
RUN cmake .. && make

FROM node:20-slim AS ui
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY package.json pnpm-lock.yaml /app/
WORKDIR /app

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY index.html tsconfig*json vite.config.ts /app/
COPY src/ /app/src
COPY public/ /app/public

RUN pnpm run build

FROM python:3.12-slim
ENV HOME="/root"
ENV TERM=xterm

RUN apt update && apt install -y libexpat-dev && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy requirements first to leverage Docker caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application files
COPY app/ app/

# Copy UI build from the previous stage
COPY --from=ui /app/app/ui/ app/ui/

# Copy SPLAT build from the previous stage
COPY --from=splat /splat/build/splat /splat/build/splat-hd /splat/utils/build/srtm2sdf* splat/

# Expose the application port
EXPOSE 8080
