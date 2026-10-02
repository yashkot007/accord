declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ACCORD_CONNECTION_ENCRYPTION_KEY?: string;
  }
}
