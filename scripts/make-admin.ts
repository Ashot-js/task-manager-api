// Gives an existing user the admin role: npm run make-admin -- user@example.com
import { pool, query } from '../src/db';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage: npm run make-admin -- user@example.com');
  const { rowCount } = await query("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
  console.log(rowCount ? `${email} is now an admin.` : `No user with email ${email}.`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
