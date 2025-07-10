import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { promises as fs } from 'fs';

export class ObjectStorageService {
  private client: S3Client;
  constructor(accessKeyId?: string, secretAccessKey?: string, endpoint?: string, region?: string) {
    if (!accessKeyId) throw Error('Cannot initialize object storage client. Access key not provided.');
    if (!secretAccessKey) throw Error('Cannot initialize object storage client. Secret key not provided.');
    if (!endpoint) throw Error('Cannot initialize object storage client. Endpoint not provided.');
    if (!region) throw Error('Cannot initialize object storage client. Region not provided.');

    this.client = new S3Client({
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      region
    });
  }

  async saveItem(options: { name: string; file: Buffer | string; bucket?: string }) {
    let data: Buffer;
    // data is a file path
    if (typeof options.file === 'string') {
      data = await fs.readFile(options.file);
    } else {
      // data is a buffer
      data = options.file;
    }
    const command = new PutObjectCommand({
      Bucket: options.bucket || process.env.STORAGE_BUCKET || 'training-gym',
      Body: data,
      Key: options.name
    });
    await this.client.send(command);
  }
}
