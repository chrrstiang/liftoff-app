import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { useContainer } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 8000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);

  console.log(`Server running at http://${host}:${port}`);
}
// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
