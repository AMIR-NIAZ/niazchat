import { NestFactory } from '@nestjs/core';
import AppModule from './modules/app/app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SocketIoAdapter } from './common/adapters/socket-io.adapter';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);

    // Fast heartbeats so dead connections are detected within seconds.
    app.useWebSocketAdapter(new SocketIoAdapter(app));

    app.useGlobalFilters(new HttpExceptionFilter());

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );
    app.enableCors({
        origin: true,
        credentials: true,
    });

    const server = await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
    // Large video uploads need more than Node's 5-minute request default; a
    // slow mobile connection sending 100 MB must not be cut off mid-request.
    server.requestTimeout = 15 * 60 * 1000;
    server.headersTimeout = 15 * 60 * 1000;
}
bootstrap();
