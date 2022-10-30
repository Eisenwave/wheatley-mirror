import {assert, expect} from "chai";

import { lookup, man7_testcase_setup } from "../src/components/man7";

type TestCase = {
    query: string | string[];
    path?: string;
};

const cases: TestCase[] = [
    {
        query: ["printf", "std::printf"],
        path: "man3/printf.3.html"
    },
    {
        query: ["fprintf", "std::fprintf"],
        path: "man3/printf.3.html"
    },
    {
        query: ["man"],
        path: "man1/man.1.html"
    },
    {
        query: ["accept"],
        path: "man2/accept.2.html"
    },
    {
        query: ["hexdump"],
        path: "man1/hexdump.1.html"
    }
];

man7_testcase_setup();

// TODO: more typo test cases

describe("man cases", () => {
    for(const test_case of cases) {
        const queries = test_case.query instanceof Array ? test_case.query : [test_case.query];
        for(const query of queries) {
            if(test_case.path) {
                it(`!cref should find ${query}`, done => {
                    const result = lookup(query);
                    assert(result, "search did not find a result when it should have");
                    expect(result.path).to.equal(test_case.path);
                    done();
                });
            } else if(test_case.path === null) {
                it(`!cref shouldn't find ${query}`, done => {
                    const result = lookup(query);
                    assert(!result, "search found a result when it shouldn't have");
                    done();
                });
            }
        }
    }
});
