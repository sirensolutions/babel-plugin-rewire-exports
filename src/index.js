import template from '@babel/template';

export default function ({types: t}) {
  const defaultIdentifier = t.identifier('default');
  const rewireIdentifier = t.identifier('rewire');
  const restoreIdentifier = t.identifier('restore');
  const stubIdentifier = t.identifier('$stub');
  const VISITED = Symbol('visited');

  const buildStub = template(`
    export function REWIRE(STUB) {
      LOCAL = STUB;
    }
  `, {sourceType: 'module'});

  const buildNamedRestore = template(`
    export function RESTORE() {
      BODY
    }
  `, {sourceType: 'module'});

  const buildDefaultRestore = template(`
    export default function RESTORE() {
      BODY
    }
  `, {sourceType: 'module'});

  function buildNamedExport(local, exported) {
    return markVisited(t.exportNamedDeclaration(null, [
      t.exportSpecifier(t.identifier(local.name), t.identifier(exported.name))
    ]));
  }

  function markVisited(node) {
    node[VISITED] = true;
    return node;
  }

  function captureVariableDeclarations(path) {
    return Object.values(path.getOuterBindingIdentifiers(path)).map(([id]) => {
      return {exported: t.cloneNode(id), local: id};
    });
  }

  return {
    name: 'rewire-exports',
    visitor: {
      Program: {
        enter(path, state) {
          state.exports = [];
          state.hasDefaultExport = false;
        },
        exit(path, {exports, hasDefaultExport}) {
          if (!exports.length) return;

          // de-duplicate the exports
          const unique = exports.reduce((acc, e) => {
            const key = e.exported.name;
            if (!acc[key]) {
              acc[key] = e;
            }
            return acc;
          }, {});
          exports = Object.keys(unique).map(k => unique[k]);

          // generate temp variables if it's required to capture original values
          const tempVars = [];
          exports.filter(e => !e.original).forEach(e => {
            const {exported, local} = e;
            if (path.scope.hasBinding(exported.name) && exported.name !== local.name) {
              e.original = exported;
            } else {
              const temp = e.original = path.scope.generateUidIdentifierBasedOnNode(exported);
              tempVars.push(t.variableDeclarator(temp, local));
            }
          });

          // generate new IDs to keep sourcemaps clean
          const rewired = exports.map(({exported, local, original}) => ({
            exported: t.identifier(exported.name),
            local: t.identifier(local.name),
            original: t.identifier(original.name)
          }));

          // generate stub functions
          const hasConflictingBinding = path.scope.hasOwnBinding('rewire');
          const stubs = rewired.map(({exported, local}) => {
            let rewire = t.isIdentifier(exported, defaultIdentifier) && !hasConflictingBinding
              ? rewireIdentifier : t.identifier(`rewire$${exported.name}`);
            return markVisited(
              buildStub({
                REWIRE: rewire,
                LOCAL: local,
                STUB: stubIdentifier
              })
            );
          });

          // generate restore function
          const restore = path.scope.hasOwnBinding('restore') ? t.identifier('restore$rewire') : restoreIdentifier;
          const assignments = rewired.map(({local, original}) => t.expressionStatement(t.assignmentExpression('=', local, original)));

          const body = [
            ...stubs,
            markVisited(hasDefaultExport
              ? buildNamedRestore({RESTORE: restore, BODY: assignments})
              : buildDefaultRestore({RESTORE: restore, BODY: assignments})
            )
          ];

          if (tempVars.length) {
            body.unshift(t.variableDeclaration('var', tempVars));
          }

          path.pushContainer('body', body);
        }
      },
      // export default
      ExportDefaultDeclaration(path, state) {
        if (path.node[VISITED]) return;

        const {exports, opts} = state;
        state.hasDefaultExport = true;

        const declaration = path.node.declaration;
        const isIdentifier = t.isIdentifier(declaration);
        const binding = isIdentifier && path.scope.getBinding(declaration.name);
        if (opts.unsafeConst && binding && binding.kind === 'const') {
          // allow to rewire constants
          binding.kind = 'let';
          binding.path.parent.kind = 'let';
        }
        const isImmutable = !binding || ['const', 'module'].includes(binding.kind);
        if (isIdentifier && !isImmutable) {
          // export default foo
          exports.push({exported: defaultIdentifier, local: declaration});
          path.replaceWith(buildNamedExport(declaration, defaultIdentifier));
        } else if (t.isFunctionDeclaration(declaration)) {
          //export default function () {}
          const id = declaration.id || path.scope.generateUidIdentifier('default');
          exports.push({exported: defaultIdentifier, local: id});
          path.replaceWith(buildNamedExport(id, defaultIdentifier));
          path.scope.removeBinding(id.name);
          path.scope.push({
            id,
            init: t.functionExpression(declaration.id, declaration.params, declaration.body, declaration.generator, declaration.async),
            unique: true
          });
        } else if (t.isClassDeclaration(declaration)) {
          //export default class {}
          const id = declaration.id || path.scope.generateUidIdentifier('default');
          exports.push({exported: defaultIdentifier, local: id});
          const [varDeclaration] = path.replaceWithMultiple([
            t.variableDeclaration('var', [
              t.variableDeclarator(id, t.classExpression(declaration.id, declaration.superClass, declaration.body, declaration.decorators || []))
            ]),
            buildNamedExport(id, defaultIdentifier)
          ]);
          path.scope.registerDeclaration(varDeclaration);
        } else {
          // export default ...
          const id = path.scope.generateUidIdentifier('default');
          exports.push({exported: defaultIdentifier, local: id});
          const [varDeclaration] = path.replaceWithMultiple([
            t.variableDeclaration('var', [t.variableDeclarator(id, declaration)]),
            buildNamedExport(id, defaultIdentifier)
          ]);
          path.scope.registerDeclaration(varDeclaration);
        }
      },
      // export {}
      ExportNamedDeclaration(path, {exports, opts}) {
        if (path.node[VISITED]) return;
        // export { foo } from './bar.js'
        if (path.node.source) return;

        const declaration = path.node.declaration;
        if (t.isVariableDeclaration(declaration)) {
          // export const foo = 'bar'
          if (declaration.kind === 'const') {
            if (opts.unsafeConst) {
              declaration.kind = 'let'; // convert const to let
            } else {
              // convert export variable declaration to export specifier
              // export const foo = 'bar'; → const foo = 'bar'; export { foo };
              const identifiers = captureVariableDeclarations(path);
              const [varDeclaration] = path.replaceWithMultiple([
                declaration,
                t.exportNamedDeclaration(null, identifiers.map(({exported, local}) =>
                  t.exportSpecifier(t.identifier(local.name), t.identifier(exported.name))
                ))
              ]);
              path.scope.registerDeclaration(varDeclaration);
              return; // visitor will handle the added export specifier later
            }
          }
          exports.push(...captureVariableDeclarations(path));
        } else if (t.isFunctionDeclaration(declaration)) {
          // export function foo() {}
          const id = declaration.id;
          exports.push({exported: t.cloneNode(id), local: id});
          path.replaceWith(buildNamedExport(id, id));
          path.scope.removeBinding(id.name);
          path.scope.push({
            id,
            init: t.functionExpression(declaration.id, declaration.params, declaration.body, declaration.generator, declaration.async),
            unique: true
          });
        } else if (t.isClassDeclaration(declaration)) {
          // export class Foo {}
          const id = declaration.id;
          exports.push({exported: t.cloneNode(id), local: id});
          const [varDeclaration] = path.replaceWithMultiple([
            t.variableDeclaration('var', [
              t.variableDeclarator(id, t.classExpression(id, declaration.superClass, declaration.body, declaration.decorators || []))
            ]),
            buildNamedExport(id, id)
          ]);
          path.scope.registerDeclaration(varDeclaration);
        } else {
          // export {foo}
          path.node.specifiers.forEach(node => {
            const {exported, local} = node;
            const binding = path.scope.getBinding(local.name);
            if (!binding) return;
            if (opts.unsafeConst && binding.kind === 'const') {
              // allow to rewire constants
              binding.kind = 'let';
              binding.path.parent.kind = 'let';
            } else if (['const', 'module'].includes(binding.kind)) {
              // const and imports
              const id = path.scope.generateUidIdentifier(local.name);
              exports.push({exported, local: id});
              const [varDeclaration] = path.insertBefore(t.variableDeclaration('var', [t.variableDeclarator(id, local)]));
              path.scope.registerDeclaration(varDeclaration);
              node.local = id;
              return;
            }
            exports.push({exported, local});
          });
        }
      }
    }
  };
}
