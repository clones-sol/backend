declare namespace Express {
  export interface Request {
    user?: {
      date_created: Date;
      address?: string | null | undefined;
      api_key?: string | null | undefined;
    };
  }
}
