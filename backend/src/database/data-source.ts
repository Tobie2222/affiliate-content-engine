import 'reflect-metadata';
import { DataSource } from 'typeorm';

// Dùng cho TypeORM CLI (migration) và script seed. Ứng dụng NestJS cấu hình riêng trong app.module.ts.
for (const file of ['.env', '../.env']) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // Không có file này thì thử file tiếp theo hoặc dùng biến môi trường có sẵn.
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  }
  return value;
}

export default new DataSource({
  type: 'postgres',
  host: required('DB_HOST'),
  port: Number(process.env.DB_PORT ?? 5432),
  username: required('DB_USER'),
  password: required('DB_PASSWORD'),
  database: required('DB_NAME'),
  entities: [],
  migrations: [`${__dirname}/migrations/*.{ts,js}`],
  synchronize: false,
});
