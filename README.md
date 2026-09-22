npm init -y

npm install prisma@7 @prisma/client@7

npx prisma init

npx prisma generate

npm install @prisma/adapter-mariadb

+ provider = "mysql"

npx prisma db pull

npx prisma migrate dev --name init --create-only

npm install prisma @types/node @types/pg --save-dev

npm install @prisma/client @prisma/adapter-pg pg dotenv

npm install prisma @types/node --save-dev
npm install @prisma/client @prisma/adapter-mariadb dotenv
npx prisma init --datasource-provider mysql --output ../generated/prisma
npx prisma db pull

npx prisma generate
