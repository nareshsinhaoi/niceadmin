import "dotenv/config";
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
// import { PrismaClient } from '../../generated/prisma/client.js';


const adapter = new PrismaMariaDb({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  port : process.env.DATABASE_PORT
  //connectionLimit: 20000
});

// export const Prisma = new PrismaClient({
//     adapter
// });


import { PrismaClient } from '../../generated/prisma/client.js' 
//const { PrismaClient } = require ('../../generated/prisma/client.js');

export const Prisma = new PrismaClient({  
  adapter
});