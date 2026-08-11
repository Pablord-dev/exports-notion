// Casos compartidos de la tabla `users`: los corre users.memory.test.ts contra el
// memory-store y db.pg.test.ts contra Postgres real. Si ambos pasan, el stub es
// fiel al SQL (misma lección D1 que reportCases.ts).
import { expect } from "vitest";

type Db = typeof import("@/lib/db");

export async function runUserAssertions(db: Db) {
  // Primer login: la fila nace con el rol menos privilegiado.
  await db.recordLogin("Pablo@Hiuman.edu.mx", "Pablo");
  // Y se guardó normalizada: la consulta en minúsculas encuentra esa misma fila.
  expect(await db.getUserRole("pablo@hiuman.edu.mx")).toBe("viewer");

  // Promoción. Un login posterior refresca la visita pero NO pisa el rol: si el
  // upsert tocara `role`, cada vez que un admin entrara volvería a ser viewer.
  await db.setUserRole("pablo@hiuman.edu.mx", "admin");
  await db.recordLogin("PABLO@hiuman.edu.mx", "Pablo Sánchez");
  expect(await db.getUserRole("pablo@hiuman.edu.mx")).toBe("admin");

  // Degradación: el script tiene que poder ir en las dos direcciones.
  await db.setUserRole("pablo@hiuman.edu.mx", "viewer");
  expect(await db.getUserRole("pablo@hiuman.edu.mx")).toBe("viewer");

  // Quien nunca entró no tiene fila. Devuelve null y lo resuelve roleOrDefault.
  expect(await db.getUserRole("nadie@hiuman.edu.mx")).toBeNull();

  // setUserRole sobre alguien que todavía no entró crea la fila: permite dejar
  // listo a un admin antes de su primer login.
  await db.setUserRole("Futuro@hiuman.edu.mx", "admin");
  expect(await db.getUserRole("futuro@hiuman.edu.mx")).toBe("admin");

  // listUsers: dos filas, no cuatro. El correo se escribió con tres grafías
  // distintas y el upsert las colapsó; si esto diera 3 o 4, la normalización de
  // la frontera se habría roto.
  const list = await db.listUsers();
  expect(list.map((u) => u.email)).toEqual(["pablo@hiuman.edu.mx", "futuro@hiuman.edu.mx"]);
  // Orden: primero quien entró, al final quien nunca lo hizo (nulls last).
  expect(list[0].lastLoginAt).not.toBeNull();
  expect(list[1].lastLoginAt).toBeNull();
  // El segundo login refrescó el nombre; el rol es el que dejó la degradación.
  expect(list[0]).toMatchObject({ role: "viewer", name: "Pablo Sánchez" });
  expect(list[0].createdAt).not.toBeNull();
  // Quien nunca entró no tiene nombre: null, no "". El SQL guarda null y el
  // stub tiene que decir lo mismo o la tabla de la UI mostraría comillas vacías.
  expect(list[1]).toMatchObject({ role: "admin", name: null });

  // deleteUser normaliza igual que el resto de la frontera…
  await db.deleteUser("PABLO@hiuman.edu.mx");
  expect(await db.getUserRole("pablo@hiuman.edu.mx")).toBeNull();
  // …borra sólo a quien se le pide…
  expect((await db.listUsers()).map((u) => u.email)).toEqual(["futuro@hiuman.edu.mx"]);
  // …y borrar a alguien que ya no está es un no-op, no un error.
  await db.deleteUser("pablo@hiuman.edu.mx");
}
