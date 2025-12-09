import { promises as fs } from 'node:fs'
import { PutObjectCommand, S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

export class ObjectStorageService {
  private client: S3Client
  private bucket: string
  constructor(
    accessKeyId: string,
    secretAccessKey: string,
    endpoint: string,
    region: string,
    bucket: string
  ) {
    if (!accessKeyId)
      throw Error('Cannot initialize object storage client. Access key not provided.')
    if (!secretAccessKey)
      throw Error('Cannot initialize object storage client. Secret key not provided.')
    if (!endpoint) throw Error('Cannot initialize object storage client. Endpoint not provided.')
    if (!region) throw Error('Cannot initialize object storage client. Region not provided.')
    if (!bucket) throw Error('Cannot initialize object storage client. Bucket not provided.')

    this.client = new S3Client({
      endpoint,
      forcePathStyle: endpoint.includes('localstack'),
      credentials: { accessKeyId, secretAccessKey },
      region
    })
    this.bucket = bucket
  }

  async saveItem(options: { name: string; file: Buffer | string; bucket?: string }) {
    let data: Buffer
    // data is a file path
    if (typeof options.file === 'string') {
      data = await fs.readFile(options.file)
    } else {
      // data is a buffer
      data = options.file
    }
    const command = new PutObjectCommand({
      Bucket: options.bucket || this.bucket,
      Body: data,
      Key: options.name
    })
    await this.client.send(command)
  }

  async getItem(options: { name: string; bucket?: string }): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: options.bucket || this.bucket,
      Key: options.name
    })

    const response = await this.client.send(command)

    if (!response.Body) {
      throw new Error(`Object not found: ${options.name}`)
    }

    // Use modern AWS SDK v3 method if available
    if ('transformToByteArray' in response.Body) {
      return Buffer.from(await response.Body.transformToByteArray())
    }

    // Fallback: Handle Node.js Readable stream properly
    const chunks: Buffer[] = []
    const body = response.Body as NodeJS.ReadableStream

    for await (const chunk of body) {
      // Ensure chunk is a Buffer (handle both string and Buffer types)
      const buffer = chunk instanceof Buffer ? chunk : Buffer.from(chunk)
      chunks.push(buffer)
    }

    return Buffer.concat(chunks)
  }

  async getItemStream(options: { name: string; bucket?: string }): Promise<NodeJS.ReadableStream> {
    const command = new GetObjectCommand({
      Bucket: options.bucket || this.bucket,
      Key: options.name
    })

    const response = await this.client.send(command)

    if (!response.Body) {
      throw new Error(`Object not found: ${options.name}`)
    }

    return response.Body as NodeJS.ReadableStream
  }

  async getItemStreamWithRange(options: {
    name: string
    bucket?: string
    range?: string // HTTP Range header value (e.g., "bytes=0-1023")
  }): Promise<{
    stream: NodeJS.ReadableStream
    contentLength: number
    contentRange?: string
    totalSize: number
  }> {
    const command = new GetObjectCommand({
      Bucket: options.bucket || this.bucket,
      Key: options.name,
      Range: options.range
    })

    const response = await this.client.send(command)

    if (!response.Body) {
      throw new Error(`Object not found: ${options.name}`)
    }

    // For range requests, S3 returns ContentRange header
    // Format: "bytes start-end/total"
    const contentRange = response.ContentRange
    const contentLength = response.ContentLength || 0

    // Extract total size from ContentRange or use ContentLength for full requests
    let totalSize = contentLength
    if (contentRange) {
      const match = contentRange.match(/bytes \d+-\d+\/(\d+)/)
      if (match) {
        totalSize = parseInt(match[1], 10)
      }
    }

    return {
      stream: response.Body as NodeJS.ReadableStream,
      contentLength,
      contentRange,
      totalSize
    }
  }

  async deleteItem(options: { name: string; bucket?: string }): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: options.bucket || this.bucket,
      Key: options.name
    })

    await this.client.send(command)
  }

  async checkFileExists(options: { name: string; bucket?: string }): Promise<{ exists: boolean; size?: number }> {
    try {
      const command = new HeadObjectCommand({
        Bucket: options.bucket || this.bucket,
        Key: options.name
      })

      const response = await this.client.send(command)

      return {
        exists: true,
        size: response.ContentLength
      }
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return { exists: false }
      }
      throw error
    }
  }
}
