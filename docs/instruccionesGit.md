# Flujo de trabajo con git

Reglas para trabajar en este repositorio. Aplican a toda sesión que modifique código.

## Antes de empezar una tarea

- El árbol debe estar limpio. Si `git status` muestra cambios sin commitear al arrancar, avísame y espera antes de editar nada.
- Una tarea = una rama = una sesión. Crea la rama desde `main` con el formato `<tipo>/<descripción-corta>` (`feat/`, `fix/`, `chore/`, `refactor/`).
- Para cambios no triviales (varios archivos, enfoque incierto, código que no conozco): propón un plan primero y no edites hasta que lo apruebe. Si el diff cabe en una frase, hazlo directo.

## Durante la implementación

- Commits pequeños y frecuentes, uno por unidad lógica de cambio. No acumules una tarea entera en un solo commit.
- Mensajes en imperativo, una línea de asunto de ≤72 caracteres y, si hace falta, un cuerpo que explique el **por qué**, no el qué.
- Antes de dar algo por terminado, corre `npm test && npm run lint && npx tsc --noEmit` y muéstrame la salida real, no un resumen de que pasó.
- Si te corrijo dos veces sobre lo mismo, para y dime qué falta en el contexto en vez de intentar una tercera variante.

## Antes de abrir el PR

- Muéstrame `git diff` de lo que vas a commitear. Yo reviso el diff, no tu resumen.
- Corre `/code-review` sobre el diff y repórtame los hallazgos que afecten corrección o los requisitos declarados. Ignora preferencias de estilo.
- Abre el PR con `gh pr create`. La descripción lleva: qué cambia, por qué, y cómo verificarlo.

## Requieren mi confirmación explícita, siempre

Nunca ejecutes estos comandos sin preguntarme primero, aunque parezcan la salida obvia de un problema:

- `git push --force` (y `--force-with-lease`)
- `git reset --hard`
- `git checkout .` / `git restore .` sobre cambios sin commitear
- `git rebase` sobre ramas ya publicadas
- `git clean -fd`

Tampoco modifiques sin avisar: migraciones ya aplicadas, lockfiles, archivos `.env`, configuración de CI.

## Trabajo en paralelo

- Tareas independientes van en su propio worktree, no en la misma rama. Crea uno con `EnterWorktree` o dímelo y lo abro con `claude --worktree <nombre>`.
- Un worktree es un checkout nuevo: instala dependencias antes de correr nada ahí.
- No asumas que un worktree ve los cambios sin commitear de otro. Están aislados a propósito.

## Nota sobre checkpoints

`/rewind` solo revierte cambios que hiciste tú, no procesos externos, y no sustituye a git. El commit es el único punto de retorno confiable: commitea antes de intentar algo arriesgado.