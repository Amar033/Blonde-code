import { SyntaxStyle, RGBA } from '@opentui/core';
import { theme } from './theme.js';

export const mdSyntaxStyle = SyntaxStyle.fromStyles({
  default:   { fg: RGBA.fromHex(theme.text.primary) },
  keyword:   { fg: RGBA.fromHex(theme.syntax.keyword),  bold: true },
  string:    { fg: RGBA.fromHex(theme.syntax.string) },
  comment:   { fg: RGBA.fromHex(theme.syntax.comment) },
  function:  { fg: RGBA.fromHex(theme.syntax.function) },
  type:      { fg: RGBA.fromHex(theme.syntax.type) },
  number:    { fg: RGBA.fromHex(theme.syntax.number) },
  operator:  { fg: RGBA.fromHex(theme.text.secondary) },
  property:  { fg: RGBA.fromHex(theme.syntax.function) },
  constant:  { fg: RGBA.fromHex(theme.syntax.number) },
  tag:       { fg: RGBA.fromHex(theme.syntax.keyword) },
  attribute: { fg: RGBA.fromHex(theme.syntax.string) },
  punctuation: { fg: RGBA.fromHex(theme.text.dim) },
});
