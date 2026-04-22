# Example: AWS Aurora MySQL

The extension works against AWS Aurora MySQL (engine `aurora-mysql`,
v8.0-compatible) with no extra configuration. The Aurora-specific concerns
are about the _driver_ + _connection_, not the extension.

## Connection string

Aurora requires TLS by default. Include `sslaccept=strict` or
`sslaccept=accept_invalid_certs`:

```
mysql://user:password@cluster.cluster-abc123.us-east-1.rds.amazonaws.com:3306/mydb?sslaccept=strict
```

## Writer vs. reader endpoints

Aurora has separate writer and reader endpoints. Prisma needs the writer
endpoint for transactional operations. If you use reader replicas for
read scaling, apply the extension separately per client instance:

```ts
const writerClient = createClient(process.env.AURORA_WRITER_URL!);
const readerClient = createClient(process.env.AURORA_READER_URL!);

function createClient(url: string) {
  return new PrismaClient({ adapter: new PrismaMariaDb(url) }).$extends(
    createBinaryUuidExtension(uuidConfig),
  );
}
```

## IAM authentication

If you use IAM auth (short-lived tokens), generate the token per request:

```ts
import { Signer } from '@aws-sdk/rds-signer';

const signer = new Signer({
  region: 'us-east-1',
  hostname: 'cluster.cluster-abc123.us-east-1.rds.amazonaws.com',
  port: 3306,
  username: 'iam-user',
});

const token = await signer.getAuthToken();
const url = `mysql://iam-user:${encodeURIComponent(token)}@cluster.cluster-abc123.us-east-1.rds.amazonaws.com:3306/mydb?sslaccept=strict`;

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) }).$extends(
  createBinaryUuidExtension(uuidConfig),
);
```

Tokens expire after 15 minutes; rotate per request or wrap with a refresher.

## RDS Proxy

If you use RDS Proxy, point the connection string at the proxy endpoint
instead of the cluster endpoint. The proxy terminates MySQL connections
and reuses them, which reduces connection churn. The extension is
transparent to this — it operates at the Prisma layer, above the driver.

## Cost considerations

Aurora charges for storage + I/O. The extension's storage win (smaller
UUID columns + smaller indexes) translates directly to lower Aurora
storage costs. Depending on your cluster config (standard vs.
I/O-optimized), the I/O savings may also be meaningful. Verify with
CloudWatch metrics after migration.
