#!/usr/bin/env python3
"""Verify pinned dictionary evidence against a separately downloaded official XML.gz.

Usage: python3 scripts/verify-wordnet-evidence.py /path/to/english-wordnet-2025.xml.gz
Read-only: does not download sources or change the catalogue. This validates source
identity, not the pedagogical completeness or accuracy of every Chinese gloss.
"""
import gzip
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
evidence = json.loads((root / 'data/catalogs/english-dictionary-sense-evidence.json').read_text())
if len(sys.argv) != 2:
    raise SystemExit(__doc__)
source = Path(sys.argv[1])
assert hashlib.sha256(source.read_bytes()).hexdigest() == evidence['sourceSha256'], 'Different dictionary source version'
wanted = {sense['senseId']: sense for entry in evidence['entries'].values() for sense in entry.get('senses', [])}
extra = {entry['additionalSense']['senseId'] for entry in evidence['entries'].values() if 'additionalSense' in entry}
found = {}
found_extra = set()
needed_synsets = {sense['synset'] for sense in wanted.values()}
definitions = {}
pos = {'n': 'n.', 'v': 'v.', 'a': 'adj.', 's': 'adj.', 'r': 'adv.'}
with gzip.open(source, 'rb') as stream:
    for _, element in ET.iterparse(stream, events=('end',)):
        if element.tag == 'LexicalEntry':
            lemma = element.find('Lemma')
            for sense in element.findall('Sense'):
                if sense.get('id') in wanted:
                    found[sense.get('id')] = (sense.get('synset'), pos[lemma.get('partOfSpeech')])
                if sense.get('id') in extra:
                    found_extra.add(sense.get('id'))
            element.clear()
        elif element.tag == 'Synset':
            if element.get('id') in needed_synsets:
                definitions[element.get('id')] = ''.join(element.find('Definition').itertext()).strip()
            element.clear()
assert set(found) == set(wanted), 'Missing recorded senses'
assert found_extra == extra, 'Missing additional source sense'
for identity, sense in wanted.items():
    assert found[identity] == (sense['synset'], sense['partOfSpeech']), identity + ': sense/POS mismatch'
    assert hashlib.sha256(definitions[sense['synset']].encode()).hexdigest() == sense['definitionSha256'], identity + ': definition changed'
print(json.dumps({'recordedSenses': len(wanted), 'additionalSenses': len(extra), 'dictionarySha256': evidence['sourceSha256'], 'result': 'passed'}))
