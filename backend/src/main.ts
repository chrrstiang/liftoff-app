import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { useContainer } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/filters/global-exception-filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Required for class-validator's DI-backed async validators (@IsUnique, @ValueExists).
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env.PORT || 8000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);

  console.log(`Server running at http://${host}:${port}`);
}
// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
