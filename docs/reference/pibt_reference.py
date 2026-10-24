"""
REFERENCE ONLY. A throwaway Python prototype of the Spec 1 movement and station rules.
It exists to prove the rules are deadlock-free on the three presets, not to be shipped.
Run:  python3 pibt_reference.py <kickoff_dir> final 2000      (recommended + max robots, 5 seeds)
      python3 pibt_reference.py <kickoff_dir> sweep 1000 fulfillment-block 24,36,45 6,8
If you port logic from it into the TypeScript sim, say so in the "how Kiro was used" write-up.
"""
import sys, json, random, pathlib
from collections import deque

K = pathlib.Path(sys.argv[1])
meta = json.loads((K / "layouts" / "layouts.json").read_text())["layouts"]
INF = 10**9


def run(l, seed, ticks, N=None, Q=6):
    g = [list(r) for r in (K / "layouts" / l["file"]).read_text().splitlines()]
    H, W = len(g), len(g[0])
    ch = [g[i // W][i % W] for i in range(W * H)]
    nb = [[] for _ in range(W * H)]
    for y in range(H):
        for x in range(W):
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H:
                    nb[y * W + x].append(ny * W + nx)
    floor = [i for i in range(W * H) if ch[i] == "."]
    pods = [i for i in range(W * H) if ch[i] == "p"]
    stations = [i for i in range(W * H) if ch[i] == "S"]
    S = len(stations)
    rnd = random.Random(seed)
    dcache = {}

    def dist(goal, allow=None):
        key = (goal, allow)
        d = dcache.get(key)
        if d is None:
            d = [INF] * (W * H)
            d[goal] = 0
            q = deque([goal])
            while q:
                c = q.popleft()
                for n in nb[c]:
                    if ch[n] == "." and d[n] == INF and (n not in access or n == allow):
                        d[n] = d[c] + 1
                        q.append(n)
            dcache[key] = d
        return d

    N = N or l["recommendedRobots"]
    pos = rnd.sample(floor, N)
    goal = list(pos)
    state = [4] * N          # 0 to pod, 1 to station, 2 service, 3 return, 4 idle/waiting for admission
    timer = [0] * N
    home = [0] * N
    stn = [0] * N
    prio = [0] * N
    reserved = set()
    queues = [deque() for _ in stations]
    holder = [None] * S
    pending = [0] * S
    access, access_of = {}, {}
    for si, sc in enumerate(stations):
        for n in nb[sc]:
            if ch[n] == ".":
                access[n] = si
                access_of[si] = n
    deliveries = [0] * N
    last_move = [0] * N
    max_idle = [0] * N
    qsum = 0

    def try_task(i):
        cand = [s for s in range(S) if len(queues[s]) + pending[s] < Q]
        if not cand:
            state[i] = 4
            goal[i] = pos[i]
            return
        while True:
            p = rnd.choice(pods)
            if p not in reserved:
                break
        reserved.add(p)
        home[i] = p

        def sd(s):
            dm = dist(stations[s], access_of[s])
            return min((dm[n] for n in nb[p] if ch[n] == "."), default=INF) + 3 * (len(queues[s]) + pending[s])
        s = min(cand, key=sd)
        stn[i] = s
        pending[s] += 1
        goal[i] = p
        state[i] = 0

    viol = 0
    for t in range(ticks):
        for i in range(N):
            if state[i] == 4:
                try_task(i)
                continue
            if state[i] == 2:
                timer[i] -= 1
                if timer[i] <= 0:
                    state[i] = 3
                    goal[i] = home[i]
                    prio[i] = 0
            elif pos[i] == goal[i]:
                prio[i] = 0
                if state[i] == 0:
                    pending[stn[i]] -= 1
                    queues[stn[i]].append(i)
                    state[i] = 1
                    goal[i] = stations[stn[i]]
                elif state[i] == 1:
                    state[i] = 2
                    timer[i] = rnd.randint(8, 14)
                elif state[i] == 3:
                    deliveries[i] += 1
                    reserved.discard(home[i])
                    try_task(i)
        for i in range(N):
            if state[i] == 3 and holder[stn[i]] == i:
                s = stn[i]
                if pos[i] != stations[s] and access_of[s] != pos[i]:
                    queues[s].remove(i)
                    holder[s] = None
        for s in range(S):
            if holder[s] is None and queues[s]:
                dm = dist(access_of[s], access_of[s])
                holder[s] = min(queues[s], key=lambda j: (dm[pos[j]], j))
        occ = {pos[i]: i for i in range(N)}
        nxt = [None] * N
        claimed = set()
        for i in range(N):
            if state[i] == 2:
                nxt[i] = pos[i]
                claimed.add(pos[i])

        def allowed(i, c):
            if c != pos[i]:
                s = access.get(c)
                if s is not None and not (state[i] in (1, 2, 3) and holder[s] == i):
                    return False
            return ch[c] == "." or c == goal[i] or c == pos[i]

        def pibt(i, parent):
            dm = dist(goal[i], access_of[stn[i]] if state[i] in (1, 3) else None)
            cands = [c for c in nb[pos[i]] + [pos[i]] if allowed(i, c)]
            rnd.shuffle(cands)
            cands.sort(key=lambda c: dm[c])
            for c in cands:
                if c in claimed:
                    continue
                if parent is not None and c == pos[parent]:
                    continue
                j = occ.get(c)
                if j is not None and j != i and nxt[j] is not None and nxt[j] == pos[i]:
                    continue
                claimed.add(c)
                nxt[i] = c
                if j is not None and j != i and nxt[j] is None:
                    if not pibt(j, i):
                        nxt[i] = None
                        continue
                return True
            nxt[i] = pos[i]
            claimed.add(pos[i])
            return False

        def eff(i):
            if state[i] == 4:
                return -2
            if state[i] == 1 and holder[stn[i]] != i:
                return -1
            return prio[i]
        order = sorted((i for i in range(N) if nxt[i] is None), key=lambda i: (-eff(i), i))
        for i in order:
            if nxt[i] is None:
                pibt(i, None)
        seen = set()
        for i in range(N):
            if nxt[i] in seen:
                viol += 1
            seen.add(nxt[i])
            for j in range(i + 1, N):
                if nxt[i] == pos[j] and nxt[j] == pos[i] and pos[i] != pos[j]:
                    viol += 1
            if nxt[i] != pos[i] and nxt[i] not in nb[pos[i]]:
                viol += 1
        for i in range(N):
            if nxt[i] != pos[i]:
                last_move[i] = t
            if state[i] not in (2, 4):
                max_idle[i] = max(max_idle[i], t - last_move[i])
            pos[i] = nxt[i]
            if state[i] not in (2, 4):
                prio[i] += 1
        qsum += sum(len(q) for q in queues)
    tot = sum(deliveries)
    return dict(layout=l["id"], N=N, Q=Q, deliveries=tot, per100=round(tot / ticks * 100, 1),
                minPer=min(deliveries), maxPer=max(deliveries), viol=viol, maxIdle=max(max_idle),
                idleRobots=sum(1 for i in range(N) if state[i] == 4))


if __name__ == "__main__":
    mode = sys.argv[2]
    ticks = int(sys.argv[3])
    if mode == "final":
        for l in meta:
            for N, tag in ((l["recommendedRobots"], "recommended"), (l["maxRobots"], "max")):
                rs = [run(l, sd, ticks, N, l["queueCap"]) for sd in (1, 2, 3, 4, 5)]
                print(f"{l['id']:18s} {tag:11s} N={N:3d} Q={l['queueCap']} per100={[r['per100'] for r in rs]} "
                      f"minPer={min(r['minPer'] for r in rs)} maxIdle={max(r['maxIdle'] for r in rs)} viol={sum(r['viol'] for r in rs)}")
    if mode == "sweep":
        which = sys.argv[4]
        l = next(x for x in meta if x["id"] == which)
        for N in map(int, sys.argv[5].split(",")):
            for Q in map(int, sys.argv[6].split(",")):
                rs = [run(l, s, ticks, N, Q) for s in (1, 2, 3)]
                print(f"N={N:3d} Q={Q} per100={[r['per100'] for r in rs]} minPer={[r['minPer'] for r in rs]} "
                      f"maxIdle={[r['maxIdle'] for r in rs]} viol={sum(r['viol'] for r in rs)} idleRobots={[r['idleRobots'] for r in rs]}")
