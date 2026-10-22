#!/usr/bin/env python3
"""Extract exact headwords from pinned, licensed pronunciation sources (no G2P).

python3 scripts/import-english-pronunciations.py CMUDICT_IPA_TXT OEWN_XML_GZ
Source files are downloaded separately; this importer never uses a browser/session.
"""
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA = '77ecbf1fb1984f29ec267a4ac3ff979bb1f44fffeaf0f0e220098b43c0397f83'
OEWN_SHA = '9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe'
REVISION = '73777bf317b25862482d805ee1feb1fe767d04e5'


def extract(us_path, oewn_path):
    us_bytes, oewn_bytes = Path(us_path).read_bytes(), Path(oewn_path).read_bytes()
    assert hashlib.sha256(us_bytes).hexdigest() == SOURCE_SHA, 'Unexpected IPA source revision'
    assert hashlib.sha256(oewn_bytes).hexdigest() == OEWN_SHA, 'Unexpected OEWN edition'
    us = dict(line.split('\t', 1) for line in us_bytes.decode().splitlines() if '\t' in line)
    lexicon = {}
    for entry in ET.fromstring(gzip.decompress(oewn_bytes)).iter('LexicalEntry'):
        lemma = entry.find('Lemma')
        values = [(p.get('variety', ''), p.text) for p in lemma.findall('Pronunciation')]
        if values:
            lexicon.setdefault(lemma.get('writtenForm'), []).append((entry.get('id'), values))
    catalog = json.loads(subprocess.check_output(['node', '-e', 'process.stdout.write(JSON.stringify(require("./shared/catalog")))'], cwd=ROOT))
    entries, evidence, pending = {}, {}, {}
    for item in catalog:
        if item['kind'] != 'word':
            continue
        # Parentheses describe inflections/aliases; their sounds never stand for the headword.
        heads = [s.strip() for s in re.split(r'\s+/\s+', item['title'].split(' (')[0])]
        rows, proof = [], []
        for head in heads:
            # Lowercase lookup must not turn IT into the pronoun it, or US into us.
            if len(head) > 1 and head.isupper():
                continue
            source_head = head.lower()
            lex = lexicon.get(head, lexicon.get(source_head, []))
            gb = sorted({ipa for _, values in lex for accent, ipa in values if accent == 'GB'})
            generic = {ipa for _, values in lex for accent, ipa in values if not accent}
            # Generic homograph readings may belong to another POS; don't pretend one GB sound covers all.
            if gb and (not generic or generic.issubset(set(gb))):
                rows.extend(dict(headword=head, accent='UK', ipa=ipa, sourceId='oewn') for ipa in gb)
                proof.extend(dict(headword=head, entryId=entry_id, pronunciations=values) for entry_id, values in lex)
            if source_head.upper() in us:
                source_head = source_head.upper()
                # CMU includes speech-recognition reductions (e.g. GOOD /gɪd/).
                # Use its first entry; reviewed heteronyms are covered separately.
                values = us[source_head].split(', ')[:1]
                rows.extend(dict(headword=head, accent='US', ipa=value, sourceId='ipa-us') for value in values)
                proof.append(dict(headword=head, sourceKey=source_head, raw=us[source_head],
                                  rowSha256=hashlib.sha256((source_head+'\t'+us[source_head]).encode()).hexdigest()))
            elif not gb and len(generic) == 1:
                # The source makes no regional claim. Never label these as British or American.
                rows.append(dict(headword=head, accent='IPA', ipa=next(iter(generic)), sourceId='oewn'))
                proof.extend(dict(headword=head, entryId=entry_id, pronunciations=values) for entry_id, values in lex)
        if rows:
            entries[item['id']] = rows
            evidence[item['id']] = proof
        else:
            pending[item['id']] = item['title']
    sources = {
        'ipa-us': dict(title='CMU Pronouncing Dictionary 0.7b · IPA 美式音标',
                       url=f'https://github.com/menelik3/cmudict-ipa/blob/{REVISION}/cmudict-0.7b-ipa.txt',
                       sha256=SOURCE_SHA, license='CMU redistribution notice retained; IPA conversion credited to Alexander Piperski'),
        'oewn': dict(title='Open English Wordnet 2025 · 音标',
                     url='https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition',
                     sha256=OEWN_SHA, license='CC BY 4.0; Princeton WordNet notice retained')}
    data = dict(checkedAt='2026-10-22', sources=sources, entries=entries, pending=pending,
                policy='按词头精确匹配；CMU 取首个词头读音，不把语音识别弱读变体混作默认读音；不拼接短语、不猜测缩写读法。UK/US 由来源区分，未分地区的只标音标。重要多音词另有逐词核对覆盖。')
    target = ROOT/'data/catalogs'
    (target/'english-pronunciations.json').write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
    (target/'english-pronunciation-evidence.json').write_text(json.dumps(dict(sources=sources, entries=evidence), ensure_ascii=False, indent=2)+'\n')
    print(f'{len(entries)} cards with source pronunciations; {len(pending)} pending (including phrases/abbreviations)')


if __name__ == '__main__':
    extract(*sys.argv[1:])
