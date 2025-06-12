FROM node:21.4.0-bookworm

WORKDIR /usr/src/app/aws
# pull the aws documentdb cert and pipeline binary
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem ./aws-global-bundle.pem

WORKDIR /usr/src/app/pipeline
ADD https://github.com/viralmind-ai/vm-pipeline/releases/latest/download/pipeline-linux-x64 ./pipeline
RUN chmod +x pipeline

WORKDIR /usr/src/app/backend/

COPY package*.json ./

# Install dependencies including build requirements
RUN apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  build-essential \
  python3 \
  ffmpeg \
  libcairo2-dev \
  libjpeg62-turbo-dev \
  libpng-dev \
  libossp-uuid-dev \
  libavcodec-dev \
  libavformat-dev \
  libavutil-dev \
  libswscale-dev \
  freerdp2-dev \
  libpango1.0-dev \
  libssh2-1-dev \
  libtelnet-dev \
  libwebsockets-dev \
  libpulse-dev \
  libssl-dev \
  libvorbis-dev \
  libwebp-dev && \
  apt-get autoremove -y

RUN npm ci
RUN npm install --global tsx

COPY . .

RUN npm run build

EXPOSE 8001
