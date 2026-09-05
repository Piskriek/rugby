#!/usr/bin/env python3
"""
Build public/assets/models/rugby_player.glb.

Takes the Quaternius CC0 *Universal Base Characters* male mesh
(Superhero_Male.glb - a male humanoid from the base-characters pack) and
welds onto it the clips we use from the *Universal Animation Library*
(UAL1.glb / UAL2.glb). The two packs share one "Universal Rig": every bone
has the same name and the same bind hierarchy, so each animation's node
indices can be remapped purely by bone name. No retarget math needed.

Clips are renamed to the vocabulary the animation state machine in
src/render/ThreePlayerManager.ts speaks (Idle/Run/Sprint/Pass/Tackle/Slide...).

CC0 1.0 - Quaternius (https://quaternius.com). See public/assets/models/CREDITS.
"""
import json, struct, sys, os

SUP = sys.argv[1]        # Superhero_Male.glb  (male base character)
UALS = sys.argv[2:-1]    # UAL1.glb UAL2.glb
OUT = sys.argv[-1]

# UAL clip name -> our in-engine clip name. Only these clips are kept.
CLIP_MAP = {
    # from UAL1.glb
    'Idle_Loop':          'Idle',
    'Walk_Loop':          'Walk',
    'Jog_Fwd_Loop':       'Run',
    'Sprint_Loop':        'Sprint',
    'Interact':           'Kick',
    'Roll':               'DiveRoll',
    'Death01':            'Death',
    'Crouch_Idle_Loop':   'Crouch',
    'Push_Loop':          'Push',
    'Jump_Land':          'JumpLand',
    # from UAL2.glb
    'OverhandThrow':      'Pass',
    'LayToIdle':          'GetUp',
    'Slide_Start':        'SlideStart',
    'Slide_Loop':         'Slide',
    'Slide_Exit':         'SlideExit',
    'Hit_Knockback':      'Tackle',
}


def load_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack('<III', data[:12])
    assert magic == 0x46546C67, f'{path}: not a GLB'
    off = 12
    js = None
    bin_chunk = b''
    while off < length:
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        off += 8
        chunk = data[off:off + clen]
        off += clen
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            bin_chunk = chunk
    return js, bin_chunk


def pad4(b):
    while len(b) % 4:
        b += b'\x00'
    return b


def pad_json(b):
    # GLB JSON chunks must be padded with ASCII whitespace (space), not NULs.
    while len(b) % 4:
        b += b' '
    return b


def write_glb(path, g, blob):
    blob = pad4(blob)
    g['buffers'] = [{'byteLength': len(blob)}]
    jb = pad_json(json.dumps(g, separators=(',', ':')).encode('utf-8'))
    total = 12 + 8 + len(jb) + 8 + len(blob)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A))
        f.write(jb)
        f.write(struct.pack('<II', len(blob), 0x004E4942))
        f.write(blob)


base, base_bin = load_glb(SUP)

# --- copy-on-write resource tables for the output GLB ---
out = {k: v for k, v in base.items() if k != 'animations'}
out['animations'] = []

acc_out = list(base.get('accessors', []))
bv_out = list(base.get('bufferViews', []))
blob = base_bin


def add_bv(data, target=None):
    global blob
    offset = len(blob)
    blob += pad4(data)
    bv = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}
    if target is not None:
        bv['target'] = target
    bv_out.append(bv)
    return len(bv_out) - 1


def copy_accessor(src_g, src_bv_bin, ai):
    """Deep-copy an accessor (and its bufferView + bytes) into the output."""
    a = dict(src_g['accessors'][ai])
    bv = src_g['bufferViews'][a['bufferView']]
    start = bv.get('byteOffset', 0)
    data = src_bv_bin[start:start + bv['byteLength']]
    a['bufferView'] = add_bv(data, bv.get('target'))
    acc_out.append(a)
    return len(acc_out) - 1


# bone name -> node index in the base character
base_node_by_name = {n.get('name'): i for i, n in enumerate(base['nodes'])}

kept = []
for ual_path in UALS:
    src, src_bin = load_glb(ual_path)
    for anim in src.get('animations', []):
        new_name = CLIP_MAP.get(anim['name'])
        if new_name is None:
            continue
        samplers = []
        for s in anim['samplers']:
            inp = copy_accessor(src, src_bin, s['input'])
            outp = copy_accessor(src, src_bin, s['output'])
            samplers.append({
                'input': inp,
                'output': outp,
                'interpolation': s.get('interpolation', 'LINEAR'),
            })
        channels = []
        ok = True
        for ch in anim['channels']:
            tgt = ch['target']
            src_node = src['nodes'][tgt['node']].get('name')
            node = base_node_by_name.get(src_node)
            if node is None:
                ok = False
                break
            channels.append({
                'sampler': ch['sampler'],
                'target': {'node': node, 'path': tgt['path']},
            })
        if not ok:
            print(f'  skip {anim["name"]}: unmapped bone')
            continue
        out['animations'].append({
            'name': new_name,
            'samplers': samplers,
            'channels': channels,
        })
        kept.append((anim['name'], new_name))

out['accessors'] = acc_out
out['bufferViews'] = bv_out

os.makedirs(os.path.dirname(OUT), exist_ok=True)
write_glb(OUT, out, blob)
print(f'wrote {OUT}')
print('clips:')
for old, new in kept:
    print(f'  {old:22s} -> {new}')
