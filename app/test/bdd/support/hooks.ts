import { SNSClient } from '@aws-sdk/client-sns';
import { GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';
import { AfterAll, BeforeAll, setDefaultTimeout } from '@cucumber/cucumber';

import { UserRole } from '@domain/enums/user-role.enum';
import {
  InternalServicesStub,
  startInternalServicesStub,
  stubIdentityUser,
} from '../../helpers/internal-services-stub';
import { signTestStaffToken } from '../../helpers/staff-jwt.helper';
import { TestContext, setupTestApp, teardownTestApp } from '../../helpers/test-app.helper';
import { bdd } from './world';

setDefaultTimeout(30_000);

let stub: InternalServicesStub | undefined;
let ctx: TestContext | undefined;

// Containers boot once per run; each scenario opens its own work order.
BeforeAll({ timeout: 300_000 }, async function () {
  stub = await startInternalServicesStub();
  // Captured so the service's JSON lines stay out of the Cucumber output.
  ctx = await setupTestApp({
    withMessaging: true,
    internalServicesUrl: stub.url,
    captureLogs: true,
  });

  const sqs = ctx.app.get(SQSClient);

  const queueUrl = async (QueueName: string): Promise<string> =>
    (await sqs.send(new GetQueueUrlCommand({ QueueName }))).QueueUrl as string;

  const admin = stubIdentityUser(stub, {
    name: 'Admin BDD',
    email: 'admin@bdd.test',
    role: UserRole.ADMIN,
  });

  const customer = await ctx.prisma.customer.create({
    data: {
      name: 'Cliente BDD',
      document: '52998224725',
      email: 'cliente@bdd.test',
      phone: '11999999999',
    },
  });

  const vehicle = await ctx.prisma.vehicle.create({
    data: { customerId: customer.id, plate: 'BDD1A23', brand: 'Fiat', model: 'Uno', year: 2020 },
  });

  // The linked access user is who the work order e-mails go to.
  const accessUser = stubIdentityUser(stub, {
    name: 'Acesso BDD',
    email: 'acesso@bdd.test',
    role: null,
  });

  await ctx.prisma.userCustomer.create({
    data: { userId: accessUser.id, customerId: customer.id },
  });

  bdd.context = {
    ctx,
    stub,
    sns: ctx.app.get(SNSClient),
    sqs,
    queueUrls: {
      billing: await queueUrl('billing.fifo'),
      inventory: await queueUrl('inventory.fifo'),
    },
    staffToken: signTestStaffToken({ sub: admin.id, email: admin.email, role: UserRole.ADMIN }),
    staffUserId: admin.id,
    customerId: customer.id,
    vehicleId: vehicle.id,
  };
});

AfterAll(async function () {
  if (ctx) await teardownTestApp(ctx);
  await stub?.close();
});
