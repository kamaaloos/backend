/// <reference types="jest" />
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';

/**
 * Walk-in: place → PENDING_PAYMENT → prepay → kitchen → pickup board → COMPLETED.
 */
describe('Walk-in pickup board (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: string;
  let branchId: string;
  let walkInToken: string;
  let kitchenDeviceToken: string;
  let pickupDeviceToken: string;

  beforeAll(async () => {
    process.env.THROTTLE_LIMIT = '10000';
    process.env.THROTTLE_TTL_MS = '60000';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'admin@restaurant.local',
        password: 'admin123',
      });
    expect([200, 201]).toContain(login.status);

    jwt = login.body.access_token ?? login.body.accessToken;
    expect(jwt).toBeTruthy();

    const branches = await request(app.getHttpServer())
      .get('/api/branches')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    expect(branches.body.length).toBeGreaterThan(0);
    branchId = branches.body[0].id;
    walkInToken = branches.body[0].walkInToken;
    expect(walkInToken).toBeTruthy();

    const kitchenDevice = await request(app.getHttpServer())
      .post('/api/devices')
      .set('Authorization', `Bearer ${jwt}`)
      .send({
        name: `E2E Walk-in Kitchen ${Date.now()}`,
        deviceType: 'KITCHEN',
        branchId,
      });
    expect([200, 201]).toContain(kitchenDevice.status);
    kitchenDeviceToken = kitchenDevice.body.token;

    const pickupDevice = await request(app.getHttpServer())
      .post('/api/devices')
      .set('Authorization', `Bearer ${jwt}`)
      .send({
        name: `E2E Pickup Display ${Date.now()}`,
        deviceType: 'CUSTOMER_DISPLAY',
        branchId,
      });
    expect([200, 201]).toContain(pickupDevice.status);
    pickupDeviceToken = pickupDevice.body.token;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('requires prepay before kitchen and pickup board', async () => {
    // Branch UUID must not work as the public walk-in key.
    await request(app.getHttpServer())
      .get(`/api/customer/walk-in/${branchId}/menu`)
      .expect(404);

    const menu = await request(app.getHttpServer())
      .get(`/api/customer/walk-in/${walkInToken}/menu`)
      .expect(200);

    const itemId = menu.body.categories?.[0]?.menuItems?.[0]?.id;
    expect(itemId).toBeTruthy();

    const created = await request(app.getHttpServer())
      .post(`/api/customer/walk-in/${walkInToken}/orders`)
      .send({
        customerName: 'Walk-in Guest',
        items: [{ menuItemId: itemId, quantity: 1 }],
      });
    expect([200, 201]).toContain(created.status);
    expect(created.body.mode).toBe('WALK_IN');
    expect(created.body.queueNumber).toBeGreaterThan(0);
    expect(created.body.status).toBe('PENDING_PAYMENT');

    const orderId = created.body.id as string;
    const queueNumber = created.body.queueNumber as number;

    // Kitchen must not see unpaid walk-in tickets.
    await request(app.getHttpServer())
      .patch(`/api/kitchen/orders/${orderId}/status`)
      .set('x-device-token', kitchenDeviceToken)
      .send({ status: 'ACCEPTED' })
      .expect(400);

    const ticketsBeforePay = await request(app.getHttpServer())
      .get('/api/kitchen/tickets')
      .set('x-device-token', kitchenDeviceToken)
      .expect(200);
    expect(
      ticketsBeforePay.body.some((t: { id: string }) => t.id === orderId),
    ).toBe(false);

    const pay = await request(app.getHttpServer())
      .post(`/api/customer/walk-in/${walkInToken}/orders/${orderId}/pay`)
      .send({ method: 'CARD' });
    expect([200, 201]).toContain(pay.status);
    expect(pay.body.order.status).toBe('NEW');

    const ticketsAfterPay = await request(app.getHttpServer())
      .get('/api/kitchen/tickets')
      .set('x-device-token', kitchenDeviceToken)
      .expect(200);
    expect(
      ticketsAfterPay.body.some((t: { id: string }) => t.id === orderId),
    ).toBe(true);

    await request(app.getHttpServer())
      .get(`/api/customer/walk-in/${walkInToken}/pickup-board`)
      .expect(401);

    let board = await request(app.getHttpServer())
      .get(`/api/customer/walk-in/${walkInToken}/pickup-board`)
      .set('x-device-token', pickupDeviceToken)
      .expect(200);
    expect(
      board.body.preparing.some(
        (e: { orderId: string }) => e.orderId === orderId,
      ),
    ).toBe(false);

    await request(app.getHttpServer())
      .patch(`/api/kitchen/orders/${orderId}/status`)
      .set('x-device-token', kitchenDeviceToken)
      .send({ status: 'ACCEPTED' })
      .expect(200);

    board = await request(app.getHttpServer())
      .get(`/api/customer/walk-in/${walkInToken}/pickup-board`)
      .set('x-device-token', pickupDeviceToken)
      .expect(200);
    expect(
      board.body.preparing.some(
        (e: { orderId: string; queueNumber: number }) =>
          e.orderId === orderId && e.queueNumber === queueNumber,
      ),
    ).toBe(true);

    for (const status of ['PREPARING', 'READY'] as const) {
      await request(app.getHttpServer())
        .patch(`/api/kitchen/orders/${orderId}/status`)
        .set('x-device-token', kitchenDeviceToken)
        .send({ status })
        .expect(200);
    }

    const finalOrder = await request(app.getHttpServer())
      .get(`/api/customer/walk-in/${walkInToken}/orders/${orderId}`)
      .expect(200);
    // Already prepaid — READY walk-in auto-completes.
    expect(finalOrder.body.status).toBe('COMPLETED');

    board = await request(app.getHttpServer())
      .get(`/api/customer/walk-in/${walkInToken}/pickup-board`)
      .set('x-device-token', pickupDeviceToken)
      .expect(200);
    expect(
      board.body.ready.some((e: { orderId: string }) => e.orderId === orderId),
    ).toBe(false);
  }, 90_000);
});
