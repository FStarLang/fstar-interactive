# FStar Interactive Mode

An interactive mode for type-checking F\* code, built as a package for
the [Atom] editor. Package was originally adapted from [atom-build].

## Installation

* You need an installation of [Atom], and it's a good idea to also
  install [atom-fstar] separately for syntax highlighting.

* Add to the `$PATH` variable the absolute path of the directory in
  which `fstar.exe` lives (normally `$FSTAR_HOME/bin`). You need to
  restart [Atom] after you make such changes.

* Run `apm install` and `apm link` in the extension's directory.

## Usage

In a F\* buffer, pressing `Ctrl+Shift+I` will place a marker in the
file and type-check the file from the previous marker (the start of
the file, if there isn't one) until the current cursor.

`Ctrl+Alt+G` will jump to the next error, if any.

`Ctrl+Alt+A` will display all the errors.

`Ctrl+Alt+C` will kill the running background F\* process.
It's useful to do this to reset your state in case you observe odd behaviors.

`Ctrl+Shift+N` will type-check the file until the first
`(* check_marker *)` comment (or to the current cursor,
like `Ctrl+Shift+I`, in case there is no such marker).

Key bindings are platform-dependent:
See the `F* Interactive` menu under `Packages` in Atom.

[Atom]: https://atom.io
[atom-fstar]: https://github.com/FStarLang/atom-fstar
[atom-build]: https://atom.io/packages/build
