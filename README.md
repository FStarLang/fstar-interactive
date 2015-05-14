# FStar Interactive Mode

An interactive mode for checking F\* code.

Adapted from [atom-build](https://atom.io/packages/build)

## Installation

* Add to the $PATH variable the absolute path of the directory in
  which `fstar.exe` lives (normally `$FSTAR_HOME/bin`)

* You also need an installation of [Atom], and it's a good idea to also install [atom-fstar].

* Type `apm install` from the root directory.

## Usage

In a F\* buffer, pressing `Ctrl+Shift+I` will place a marker in the file and 
type-check the file from the previous marker (the start of the file, if there isn't one) 
until the current cursor. 

`Ctrl+Shift+G` will jump to the next error, if any. 

`Ctrl+Shift+A` will display all the errors. 

Key bindings are platform-dependent: See the `F* Interactive` menu under `Packages` in Atom.

[Atom]: https://atom.io
[atom-fstar]: https://github.com/FStarLang/atom-fstar
