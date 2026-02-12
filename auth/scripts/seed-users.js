import { createAuthService, InMemoryUserStore } from "../index.js";

async function main() {
  const userStore = new InMemoryUserStore();
  const auth = createAuthService({
    userStore,
    config: {
      minPasswordLength: 5
    }
  });

  const created = await auth.create_regular_users_1_to_10();
  const users = await userStore.listUsers();

  console.log("Created users:", created.length);
  console.log(
    users.map((user) => ({
      id: user.id,
      username: user.username,
      password_hash: user.password_hash,
      password_algo: user.password_algo
    }))
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

