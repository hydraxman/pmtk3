function test_graphviz_guard(root)
addpath(fullfile(root, 'demo-lab', 'octave'));
commands = {'dot -GconcentrateUnknown', 'dot -Nfontsize=bad', ...
    'dot -Earrowsize=1;whoami', 'dot -Epenwidth=../outside'};
for k = 1:numel(commands)
    rejected = false;
    try
        demo_lab_system(commands{k});
    catch err
        assert(strcmp(err.identifier, 'demo_lab:blockedSystem'));
        rejected = true;
    end
    assert(rejected);
end
status = demo_lab_system('dot -Gconcentrate -Nfontsize=50 -Earrowsize=2 -Epenwidth=5 -V');
assert(status == 0);
fprintf('Reviewed Graphviz boolean/numeric options work; nearby invalid and shell requests remain blocked.\n');
end
