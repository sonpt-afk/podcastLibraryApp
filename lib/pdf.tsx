import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { marked, type Token, type Tokens } from 'marked';
import type { ReactNode } from 'react';

export interface PdfEbook {
  title: string;
  subtitle: string;
  author: string;
  accentColor: string;
  chapters: { title: string; markdown: string }[];
}

// 6x9 in trade paperback, in points. Built-in Times/Helvetica: no font files to ship.
const PAGE = { width: 432, height: 648 };

const s = StyleSheet.create({
  page: { paddingVertical: 54, paddingHorizontal: 50, fontFamily: 'Times-Roman', fontSize: 11, lineHeight: 1.45 },
  p: { marginBottom: 8, textAlign: 'justify' },
  h: { fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  quote: { marginLeft: 12, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#999999', marginBottom: 8, fontFamily: 'Times-Italic' },
  li: { flexDirection: 'row', marginBottom: 3 },
  folio: { position: 'absolute', bottom: 28, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: '#777777' },
});

// ponytail: inline styling limited to bold/italic; links render as their text, code as plain text.
function inline(tokens: Token[] = []): ReactNode[] {
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'strong':
        return <Text key={i} style={{ fontFamily: 'Times-Bold' }}>{inline((t as Tokens.Strong).tokens)}</Text>;
      case 'em':
        return <Text key={i} style={{ fontFamily: 'Times-Italic' }}>{inline((t as Tokens.Em).tokens)}</Text>;
      case 'br':
        return '\n';
      default: {
        const tt = t as Tokens.Generic;
        return tt.tokens ? <Text key={i}>{inline(tt.tokens)}</Text> : (tt.text ?? tt.raw ?? '');
      }
    }
  });
}

function blocks(tokens: Token[], key = ''): ReactNode[] {
  return tokens.flatMap((t, i): ReactNode[] => {
    const k = `${key}${i}`;
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading;
        return [<Text key={k} style={[s.h, { fontSize: h.depth <= 2 ? 15 : 12 }]}>{inline(h.tokens)}</Text>];
      }
      case 'paragraph':
        return [<Text key={k} style={s.p}>{inline((t as Tokens.Paragraph).tokens)}</Text>];
      case 'blockquote':
        return [<View key={k} style={s.quote}>{blocks((t as Tokens.Blockquote).tokens, k)}</View>];
      case 'list': {
        const l = t as Tokens.List;
        return l.items.map((it, j) => (
          <View key={`${k}.${j}`} style={s.li}>
            <Text style={{ width: 16 }}>{l.ordered ? `${j + 1}.` : '•'}</Text>
            <Text style={{ flex: 1 }}>{inline(it.tokens.flatMap((x) => (x.type === 'text' ? ((x as Tokens.Text).tokens ?? [x]) : [x])))}</Text>
          </View>
        ));
      }
      case 'space':
      case 'hr':
        return [];
      default:
        return [<Text key={k} style={s.p}>{(t as Tokens.Generic).text ?? ''}</Text>];
    }
  });
}

/** Drop the leading "# Title" the drafter emits; the opener page already shows it. */
const body = (md: string) => marked.lexer(md).filter((t, i, all) => !(t.type === 'heading' && (t as Tokens.Heading).depth === 1 && all.findIndex((x) => x.type === 'heading') === i));

function EbookDoc({ e }: { e: PdfEbook }) {
  return (
    <Document title={e.title} author={e.author}>
      <Page size={PAGE} style={[s.page, { justifyContent: 'center' }]}>
        <View style={{ height: 6, backgroundColor: e.accentColor, marginBottom: 24 }} />
        <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 28, lineHeight: 1.15, color: e.accentColor }}>{e.title}</Text>
        {e.subtitle ? <Text style={{ fontSize: 14, marginTop: 10 }}>{e.subtitle}</Text> : null}
        {e.author ? <Text style={{ fontSize: 12, marginTop: 40, fontFamily: 'Helvetica' }}>{e.author}</Text> : null}
      </Page>

      <Page size={PAGE} style={s.page}>
        <Text style={[s.h, { fontSize: 18, marginTop: 0, color: e.accentColor }]}>Contents</Text>
        {e.chapters.map((c, i) => (
          <Text key={i} style={{ marginBottom: 6 }}>{`${i + 1}.  ${c.title}`}</Text>
        ))}
      </Page>

      {e.chapters.map((c, i) => (
        <Page key={i} size={PAGE} style={s.page}>
          <View style={{ marginTop: 60, marginBottom: 28 }}>
            <Text style={{ fontFamily: 'Helvetica', fontSize: 11, color: e.accentColor, letterSpacing: 2 }}>{`CHAPTER ${i + 1}`}</Text>
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 22, lineHeight: 1.2, marginTop: 6 }}>{c.title}</Text>
          </View>
          {blocks(body(c.markdown))}
          <Text style={s.folio} render={({ pageNumber }) => `${pageNumber}`} fixed />
        </Page>
      ))}
    </Document>
  );
}

export const renderEbookPdf = (e: PdfEbook) => renderToBuffer(<EbookDoc e={e} />);
