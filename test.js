import { Prisma } from './src/config/db.js';

async function test() {
  const users = await Prisma.pam_users.findMany();
  console.log(users.length);

  console.log(JSON.stringify( users ))
}

test();