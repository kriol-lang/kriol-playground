import { LanguageSupport, StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

type KriolState = {
  inBlockComment: boolean;
};

const keywords = /^(fn|dipoz|inpristan)\b/;
const controlKeywords = /^(si|sinon|pa|nkuantu|para|kontinua|divolvi|sai|konfirma)\b/;
const builtinFunctions = /^(mostra|mostran)\b/;
const types = /^(nter|num|textu|bool)\b/;
const booleans = /^(sin|nau)\b/;

const kriolStreamLanguage = StreamLanguage.define<KriolState>({
  name: 'kriol',
  startState: () => ({ inBlockComment: false }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.skipTo('*/')) {
        stream.pos += 2;
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return 'comment';
    }

    if (stream.eatSpace())
      return null;

    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    if (stream.match('/*')) {
      state.inBlockComment = true;
      return 'comment';
    }

    if (stream.match(/f"(?:[^"\\{]|\\.|\{[^}]*\})*"/) || stream.match(/f'(?:[^'\\{]|\\.|\{[^}]*\})*'/))
      return 'string.special';

    if (stream.match(/"(?:[^"\\]|\\.)*"/) || stream.match(/'(?:[^'\\]|\\.)*'/))
      return 'string';

    if (stream.match(/^[0-9]+\.[0-9]+/))
      return 'number';

    if (stream.match(/^[0-9]+/))
      return 'number';

    if (stream.match(controlKeywords))
      return 'keyword';

    if (stream.match(keywords))
      return 'keyword';

    if (stream.match(types))
      return 'type';

    if (stream.match(booleans))
      return 'bool';

    if (stream.match(builtinFunctions))
      return 'builtin';

    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/))
      return 'variableName';

    if (stream.match(/^(\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||[+\-*/<>=!])/))
      return 'operator';

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: {
      line: '//',
      block: { open: '/*', close: '*/' },
    },
    closeBrackets: {
      brackets: ['(', '[', '{', '"', "'"],
    },
  },
});

const kriolHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#7c3aed', fontWeight: '600' },
  { tag: t.controlKeyword, color: '#b45309', fontWeight: '600' },
  { tag: t.typeName, color: '#0369a1', fontWeight: '600' },
  { tag: t.number, color: '#0f766e' },
  { tag: t.bool, color: '#be123c' },
  { tag: t.string, color: '#15803d' },
  { tag: t.special(t.string), color: '#15803d' },
  { tag: t.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: t.operator, color: '#475569' },
  { tag: t.standard(t.variableName), color: '#2563eb' },
]);

export function kriolLanguage() {
  return new LanguageSupport(kriolStreamLanguage, [
    syntaxHighlighting(kriolHighlightStyle),
  ]);
}
