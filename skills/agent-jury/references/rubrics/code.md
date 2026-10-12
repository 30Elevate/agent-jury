# Code: a function, a module, a pull request

Pick 3 to 6. Judge the diff or the file the host names, plus its tests if they exist.

- does-the-job: the code does what the task says, for the normal input and for the edge cases the task names
- tests-prove-it: the tests in the diff fail without the change and pass with it (or: the task says no tests)
- no-dead-code: nothing added is unused, commented out, or duplicated from an existing helper
- reads-like-neighbours: naming, structure and error handling match the surrounding code
- errors-say-what: every error a user can hit names the input and what to do
- scope: the diff touches only what the task asked for

Not criteria: "I would structure it differently", "could use a library", formatting the project's linter already enforces.
