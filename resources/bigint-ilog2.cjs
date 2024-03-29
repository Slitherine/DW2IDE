// some huge powers of 2
const big2p1000p2 = 2n ** (1000n ** 2n);
const big2p1000 = 2n ** 1000n;
const big2p100 = 2n ** 100n;

// powers of 2 between 17 and 52 for convenience of notation
const n2p52 = 4503599627370496;
const n2p51 = 2251799813685248;
const n2p50 = 1125899906842624;
const n2p49 = 562949953421312;
const n2p48 = 281474976710656;
const n2p47 = 140737488355328;
const n2p46 = 70368744177664;
const n2p45 = 35184372088832;
const n2p44 = 17592186044416;
const n2p43 = 8796093022208;
const n2p42 = 4398046511104;
const n2p41 = 2199023255552;
const n2p40 = 1099511627776;
const n2p39 = 549755813888;
const n2p38 = 274877906944;
const n2p37 = 137438953472;
const n2p36 = 68719476736;
const n2p35 = 34359738368;
const n2p34 = 17179869184;
const n2p33 = 8589934592;
const n2p32 = 4294967296;
const n2p31 = 2147483648;
const n2p30 = 1073741824;
const n2p29 = 536870912;
const n2p28 = 268435456;
const n2p27 = 134217728;
const n2p26 = 67108864;
const n2p25 = 33554432;
const n2p24 = 16777216;
const n2p23 = 8388608;
const n2p22 = 4194304;
const n2p21 = 2097152;
const n2p20 = 1048576;
const n2p19 = 524288;
const n2p18 = 262144;
const n2p17 = 131072;
function BigintIlog2(value) {
    let bits = 0n;
    // note: these are conditionals are staggered this way
    // to avoid loading the big numbers into memory unless
    // they are necessary, hopefully the compiler can do
    // some tricks to optimize this
    if (value > n2p52) {
        if (value > big2p100) {
            if (value > big2p1000) {
                while (value >= big2p1000p2) {
                    value >>= 1000n ** 2n;
                    bits += 1000n ** 2n;
                }
            }
            while (value >= big2p1000) {
                value >>= 1000n;
                bits += 1000n;
            }
        }
        while (value >= big2p100) {
            value >>= 100n;
            bits += 100n;
        }
    }
    while (value >= n2p52) {
        value >>= 52n;
        bits += 52n;
    }
    if (value >= n2p51) return bits + 51n;
    if (value >= n2p50) return bits + 50n;
    if (value >= n2p49) return bits + 49n;
    if (value >= n2p48) return bits + 48n;
    if (value >= n2p47) return bits + 47n;
    if (value >= n2p46) return bits + 46n;
    if (value >= n2p45) return bits + 45n;
    if (value >= n2p44) return bits + 44n;
    if (value >= n2p43) return bits + 43n;
    if (value >= n2p42) return bits + 42n;
    if (value >= n2p41) return bits + 41n;
    if (value >= n2p40) return bits + 40n;
    if (value >= n2p39) return bits + 39n;
    if (value >= n2p38) return bits + 38n;
    if (value >= n2p37) return bits + 37n;
    if (value >= n2p36) return bits + 36n;
    if (value >= n2p35) return bits + 35n;
    if (value >= n2p34) return bits + 34n;
    if (value >= n2p33) return bits + 33n;
    if (value >= n2p32) return bits + 32n;
    if (value >= n2p31) return bits + 31n;
    if (value >= n2p30) return bits + 30n;
    if (value >= n2p29) return bits + 29n;
    if (value >= n2p28) return bits + 28n;
    if (value >= n2p27) return bits + 27n;
    if (value >= n2p26) return bits + 26n;
    if (value >= n2p25) return bits + 25n;
    if (value >= n2p24) return bits + 24n;
    if (value >= n2p23) return bits + 23n;
    if (value >= n2p22) return bits + 22n;
    if (value >= n2p21) return bits + 21n;
    if (value >= n2p20) return bits + 20n;
    if (value >= n2p19) return bits + 19n;
    if (value >= n2p18) return bits + 18n;
    if (value >= n2p17) return bits + 17n;
    if (value >= 65536) return bits + 16n;
    if (value >= 32768) return bits + 15n;
    if (value >= 16384) return bits + 14n;
    if (value >= 8192) return bits + 13n;
    if (value >= 4096) return bits + 12n;
    if (value >= 2048) return bits + 11n;
    if (value >= 1024) return bits + 10n;
    if (value >= 512) return bits + 9n;
    if (value >= 256) return bits + 8n;
    if (value >= 128) return bits + 7n;
    if (value >= 64) return bits + 6n;
    if (value >= 32) return bits + 5n;
    if (value >= 16) return bits + 4n;
    if (value >= 8) return bits + 3n;
    if (value >= 4) return bits + 2n;
    if (value >= 2) return bits + 1n;
    return bits;
}
BigInt.ilog2 = BigintIlog2;
