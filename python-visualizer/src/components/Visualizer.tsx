import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';

const PYTHON_BUILTINS = new Set([
  'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'bytearray', 'bytes', 'callable', 'chr',
  'classmethod', 'compile', 'complex', 'delattr', 'dict', 'dir', 'divmod', 'enumerate',
  'eval', 'exec', 'filter', 'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr',
  'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len',
  'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open',
  'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round', 'set', 'setattr',
  'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip',
  'random', 're', 'math', 'string', 'sys', 'os', 'json', 'time', 'datetime'
]);

export function Visualizer() {
  const { timeline, currentStepIndex, scaffold } = useAppStore();
  const [zoomLevel, setZoomLevel] = useState(1);
  const currentStep = timeline[currentStepIndex];

  const hasPrintToken = scaffold?.lines?.some(l => l.tokens.some(t => t.value === 'print')) || false;

  if (!scaffold || !currentStep) {
    return (
      <div className="pane pane-visualizer">
        <div className="panel-header">Execution Visualization</div>
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '10%' }}>
          Awaiting valid Python code to trace...
        </div>
      </div>
    );
  }

  // Reconstruct scopes chronologically per line
  // This achieves "Historical Line Locking" so past declarations don't mistakenly update
  const lineScopes: Record<number, { before: Record<string, string>, after: Record<string, string> }> = {};
  const lineChainReturns: Record<number, any[]> = {};
  const executedLines = new Set<number>();
  const returnedValues: Record<string, string> = {};
  const functionScopes: Record<string, Record<string, string>> = {};
  
  for (let i = 0; i <= currentStepIndex; i++) {
    const step = timeline[i];
    if (step && step.line > 0) {
      executedLines.add(step.line);
      const beforeScope = step.stack.reduce((acc: any, frame: any) => ({ ...acc, ...frame.scope }), {});
      
      const nextStep = timeline[i + 1] || step;
      const isExiting = nextStep.stack.length < step.stack.length || step.event === 'return' || step.event === 'exception';
      const afterScope = isExiting ? beforeScope : nextStep.stack.reduce((acc: any, frame: any) => ({ ...acc, ...frame.scope }), {});
      
      lineScopes[step.line] = { before: beforeScope, after: afterScope };
      
      if (step.chain_returns && step.chain_returns.length > 0) {
        lineChainReturns[step.line] = step.chain_returns;
      }
      
      // Track latest scope per function frame for localized parameter rendering
      for (const frame of step.stack) {
        if (frame.name !== "Global Scope") {
           functionScopes[frame.name] = { ...(functionScopes[frame.name] || {}), ...frame.scope };
        }
      }
    }
    if (step && step.event === 'return' && step.return_data) {
      returnedValues[step.return_data.function] = step.return_data.value;
    }
  }





  return (
    <div className="pane pane-visualizer" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>Visual AST Trace</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', padding: '2px 6px' }}>
              <button className="btn" style={{ padding: '0 4px', fontSize: '1rem', height: 'auto', background: 'transparent', minWidth: 'auto', border: 'none' }} onClick={() => setZoomLevel(z => Math.max(0.4, z - 0.1))} title="Zoom Out">-</button>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', minWidth: '35px', textAlign: 'center' }}>{Math.round(zoomLevel * 100)}%</span>
              <button className="btn" style={{ padding: '0 4px', fontSize: '1rem', height: 'auto', background: 'transparent', minWidth: 'auto', border: 'none' }} onClick={() => setZoomLevel(z => Math.min(2.5, z + 0.1))} title="Zoom In">+</button>
          </div>
        </div>
        <div style={{ color: 'var(--accent-primary)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
          Step 
          <input 
            type="number" 
            min="1" 
            max={timeline.length} 
            value={currentStepIndex + 1}
            onChange={(e) => {
               const val = parseInt(e.target.value);
               if (!isNaN(val) && val >= 1 && val <= timeline.length) {
                   useAppStore.getState().setCurrentStepIndex(val - 1);
               }
            }}
            style={{ 
              background: 'rgba(0,0,0,0.4)', border: '1px solid var(--accent-primary)', 
              color: 'var(--text-primary)', width: '40px', textAlign: 'center', borderRadius: '4px',
              fontFamily: 'var(--font-mono)', fontSize: '0.75rem' 
            }} 
          />
          / {timeline.length}
        </div>
      </div>

      <div className="timeline-container" style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
        <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left', transition: 'transform 0.2s ease-out', width: `calc(100% / ${zoomLevel})` }}>
        {/* Render Classes First */}
        {scaffold.classes && scaffold.classes.map((cls) => {
          const clsLines = scaffold.lines.filter(
            (l) => l.line > cls.startLine && l.line <= cls.endLine && l.text.trim() !== '' && !scaffold.functions.some((f) => l.line >= f.startLine && l.line <= f.endLine)
          );
          const clsFuncs = scaffold.functions.filter(f => f.startLine >= cls.startLine && f.endLine <= cls.endLine);

          return (
            <motion.div
              layout
              key={`class-${cls.name}`}
              className="class-container"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{
                border: '2px dashed rgba(234, 179, 8, 0.4)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '24px',
                background: 'rgba(66, 32, 6, 0.2)',
                position: 'relative'
              }}
            >
              <div 
                style={{ 
                  color: '#fef08a', 
                  fontWeight: 'bold', 
                  fontSize: '1.2rem',
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  paddingBottom: '12px',
                  marginBottom: '16px',
                }}
              >
                class {cls.name}{cls.bases.length > 0 ? `(${cls.bases.join(', ')})` : ''}:
              </div>

              {clsFuncs.map(func => <FunctionBlock key={func.name} func={func} scaffold={scaffold} lineScopes={lineScopes} returnedValues={returnedValues} functionScopes={functionScopes} currentStep={currentStep} lineChainReturns={lineChainReturns} />)}

              <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <AnimatePresence mode="popLayout">
                  {clsLines.map((lineModel) => (
                    <LineRenderer 
                      key={`line-${lineModel.line}`} 
                      lineModel={lineModel} 
                      scopes={lineScopes[lineModel.line] || { before: {}, after: {} }} 
                      returnedValues={returnedValues}
                      chainReturns={lineChainReturns[lineModel.line] || []}
                      isActive={currentStep.line === lineModel.line}
                      assignments={scaffold.assignments}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}

        {/* Render Functions NOT in any Class */}
        {scaffold.functions.filter(f => !(scaffold.classes && scaffold.classes.some(c => f.startLine >= c.startLine && f.endLine <= c.endLine))).map((func) => (
           <FunctionBlock key={func.name} func={func} scaffold={scaffold} lineScopes={lineScopes} returnedValues={returnedValues} functionScopes={functionScopes} currentStep={currentStep} lineChainReturns={lineChainReturns} />
        ))}

        {/* Render Global Code Lines (not in any function or class) */}
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <AnimatePresence mode="popLayout">
            {scaffold.lines
              .filter(l => l.text.trim() !== '')
              .filter((l) => !scaffold.functions.some((f) => l.line >= f.startLine && l.line <= f.endLine))
              .filter((l) => !(scaffold.classes && scaffold.classes.some(c => l.line >= c.startLine && l.line <= c.endLine)))
              .map((lineModel) => (
                <LineRenderer 
                  key={`line-${lineModel.line}`} 
                  lineModel={lineModel} 
                  scopes={lineScopes[lineModel.line] || { before: {}, after: {} }} 
                  returnedValues={returnedValues}
                  chainReturns={lineChainReturns[lineModel.line] || []}
                  isActive={currentStep.line === lineModel.line}
                  assignments={scaffold.assignments}
                />
            ))}
          </AnimatePresence>
        </div>
        {/* Terminal Print Renderer */}
        <AnimatePresence>
          {(hasPrintToken || (currentStep.stdout && currentStep.stdout.trim() !== "")) && (
            <motion.div
              key="terminal"
              layout
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="terminal-block"
              style={{
                marginTop: '32px',
                background: '#000',
                border: '1px solid #333',
                borderRadius: '8px',
                padding: '16px',
                fontFamily: 'var(--font-mono)',
                boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.8)'
              }}
            >
              <div style={{ color: '#4ade80', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '8px' }}>
                Terminal Output &gt;_
              </div>
              <pre style={{ margin: 0, color: '#f8fafc', fontSize: '0.9rem', whiteSpace: 'pre-wrap', minHeight: '1.2em' }}>
                {currentStep.stdout}
              </pre>
            </motion.div>
          )}

          {/* Error Traceback Renderer */}
          {currentStep.event === 'error' && currentStep.error && (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{
                border: '2px solid rgba(239, 68, 68, 0.4)',
                borderRadius: '8px',
                padding: '16px',
                marginTop: '16px',
                background: 'rgba(127, 29, 29, 0.3)'
              }}
            >
              <div style={{ color: '#fca5a5', fontWeight: 'bold', marginBottom: '8px' }}>Runtime Exception</div>
              <pre style={{ color: '#f87171', fontSize: '0.75rem', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>
                {currentStep.error}
              </pre>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function FunctionBlock({ func, scaffold, lineScopes, returnedValues, functionScopes, currentStep, lineChainReturns }: any) {
  const funcLines = scaffold.lines.filter((l: any) => l.line > func.startLine && l.line <= func.endLine && l.text.trim() !== '');
  if (funcLines.length === 0) return null;

  const isFunctionActive = currentStep.stack.some((s: any) => s.name === func.name) || func.name === '__init__';

  return (
    <motion.div
      layout
      key={`func-${func.name}`}
      className="function-container"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{
        border: '2px solid rgba(99, 102, 241, 0.4)',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '24px',
        background: 'rgba(15, 23, 42, 0.4)',
        position: 'relative'
      }}
    >
      <div 
        style={{ 
          color: 'var(--accent-secondary)', fontWeight: 'bold', fontSize: '1.2rem',
          borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px', marginBottom: '16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}
      >
        <span>{func.name}()</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {func.args.map((argName: string) => {
            const funcScope = isFunctionActive ? (functionScopes[func.name] || {}) : {};
            const val = funcScope[argName];
            if (!val) return null;
            return (
              <motion.div 
                key={argName}
                layout
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                title={val}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--accent-primary)',
                  borderRadius: '6px', padding: '4px 8px', fontSize: '0.75rem',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '40px', maxWidth: '200px'
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>{argName}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{val}</span>
              </motion.div>
            )
          })}
        </div>
      </div>
      <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <AnimatePresence mode="popLayout">
          {funcLines.map((lineModel: any) => (
            <LineRenderer 
              key={`line-${lineModel.line}`} 
              lineModel={lineModel} 
              scopes={isFunctionActive ? (lineScopes[lineModel.line] || { before: {}, after: {} }) : { before: {}, after: {} }} 
              returnedValues={returnedValues}
              chainReturns={isFunctionActive ? (lineChainReturns[lineModel.line] || []) : []}
              isActive={currentStep.line === lineModel.line}
              assignments={scaffold.assignments}
            />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function LineRenderer({ lineModel, scopes, returnedValues, chainReturns = [], isActive = false, assignments = [] }: any) {
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && lineRef.current) {
      lineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isActive]);

  const isMultiLineSubsequent = assignments?.some((a: any) => lineModel.line > a.startLine && lineModel.line <= a.endLine);
  if (isMultiLineSubsequent) {
    return null; // Cleanly hide interior lines of a multi-line assignment block
  }

  const variables = lineModel.tokens.filter((t: any) => t.type === 'variable');
  const firstTokenCol = lineModel.indentCols !== undefined ? lineModel.indentCols : (lineModel.tokens.length > 0 ? lineModel.tokens[0].startCol : 0);
  const isDefLine = lineModel.text.trim().startsWith('def ') || lineModel.text.trim().startsWith('class ');
  const isAssignmentStart = assignments?.some((a: any) => lineModel.line === a.startLine);
  const isConstantInit = variables.length === 1 && lineModel.text.includes('=') && 
      (isAssignmentStart || (!lineModel.text.includes('(') && !lineModel.text.includes('+') && !lineModel.text.includes('[')));

  return (
    <motion.div
      ref={lineRef}
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ 
        opacity: 1, x: 0, 
        backgroundColor: isActive ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0)'
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        fontFamily: 'var(--font-mono)',
        padding: '6px 12px',
        marginLeft: `${firstTokenCol * 8}px`,
        borderRadius: '6px',
        borderLeft: isActive ? '3px solid var(--accent-primary)' : '3px solid transparent'
      }}
    >
      <div style={{ width: '24px', color: 'var(--text-muted)', fontSize: '0.75rem', opacity: 0.5, userSelect: 'none' }}>
        {lineModel.line}
      </div>

      {isConstantInit ? (
        // Render Collapsed Simplified Constant Block + Retain indent if available
        <>
          {lineModel.tokens[0].type === 'syntax' && lineModel.tokens[0].value.trim() === '' && (
            <span style={{ color: 'var(--text-secondary)' }}>{lineModel.tokens[0].value}</span>
          )}
          <VariableToken tok={variables[0]} scope={scopes.after} isLHS={true} returnedValues={returnedValues} chainReturns={chainReturns} />
        </>
      ) : (
        // Render Standard Tokenized Layout
        lineModel.tokens.map((tok: any, i: number) => {
          if (tok.type === 'syntax' || isDefLine) {
            return (
              <span key={i} style={{ color: 'var(--text-secondary)' }}>
                {tok.value}
              </span>
            );
          }
          
          // Heuristic: if it's the first variable before an equals sign, it's typically LHS receiving evaluated ghost flights
          // Also explicitly catch 'for' loops parameter LHS evaluation targeting the variable before 'in' keyword!
          const isForLoopLHS = lineModel.text.trim().startsWith('for ') && tok.value !== 'for' && tok.value !== 'in' && lineModel.text.indexOf(' in ') >= tok.endCol;
          const isLHS = (lineModel.text.indexOf('=') > tok.endCol && i < 3) || isForLoopLHS;
          
          return <VariableToken key={i} tok={tok} scope={isLHS ? scopes.after : scopes.before} isLHS={isLHS} returnedValues={returnedValues} chainReturns={chainReturns} />;
        })
      )}
    </motion.div>
  );
}

function VariableToken({ tok, scope, isLHS, returnedValues, chainReturns = [] }: { tok: any, scope: Record<string, string>, isLHS: boolean, returnedValues: Record<string, string>, chainReturns?: any[] }) {
  let val = scope ? scope[tok.value] : undefined;
  
  const isFunctionValue = val && (val.startsWith('<function') || val.startsWith('<built-in') || val.startsWith('<module'));
  
  let isFunction = false;
  let varColor = 'var(--text-muted)';
  
  let delayAmount = 0;
  const chainMatch = chainReturns.find((c: any) => c.col >= tok.startCol && c.col <= tok.endCol + 5 && c.method === tok.value);
  if (chainMatch) {
     val = chainMatch.value;
     isFunction = true;
     delayAmount = tok.startCol * 0.05; // Left-to-right cascade stagger mapped organically natively to physical token positioning!
  } else if (isFunctionValue) {
    isFunction = true;
  } else if (PYTHON_BUILTINS.has(tok.value) || (returnedValues && returnedValues[tok.value])) {
    isFunction = true;
  }

  if (isFunction) {
    varColor = '#c084fc'; // Purple for functions/modules
    if (returnedValues && returnedValues[tok.value]) {
        val = returnedValues[tok.value]; // Display return value instead of <function...>
    } else if (isFunctionValue) {
        // extract name from <function name> or <module 'name'>
        const match = val?.match(/<(?:built-in )?(?:function|module) '?([a-zA-Z0-9._/]+)'?>/);
        val = match ? match[1] : undefined; 
    }
  }

  const hasValue = val !== undefined && val !== null && val !== "<unserializable>";
  let valColor = (hasValue && val) ? (val.startsWith("'") || val.startsWith('"') ? '#fde047' : '#93c5fd') : 'transparent';
  if (isFunction && hasValue) {
      valColor = '#e879f9'; // Pinkish for function returns
  }

  return (
    <motion.div
      layout
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.3)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '6px',
        margin: '0 4px',
        padding: '2px 6px',
        minWidth: '40px',
        maxWidth: '350px',
        verticalAlign: 'middle',
        position: 'relative',
        top: '-4px' // align visually against text
      }}
      title={hasValue ? val : undefined}
    >
      <span style={{ fontSize: '0.7rem', color: varColor }}>
          {tok.value} {isFunction && returnedValues && returnedValues[tok.value] ? '| Ret' : ''}
      </span>
      <div style={{ position: 'relative', minHeight: '1.2em', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
          <AnimatePresence mode="popLayout">
            {hasValue && (
              <motion.span
                key={`val-${tok.value}-${val}`} // Uniquely binds evaluation state footprint natively
                initial={{ 
                  opacity: 0, 
                  // Ghost flight mechanics: LHS tokens fly wildly from the far right (representing RHS payload extraction collapsing down)
                  x: isLHS ? 120 : 0, 
                  y: isLHS ? -30 : -10, 
                  scale: isLHS ? 1.5 : 0.8 
                }}
                animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }} // Changed exit so the block doesn't violently fly out, keeping UX stable
                transition={{ type: 'spring', stiffness: isLHS ? 100 : 180, damping: isLHS ? 15 : 20, delay: delayAmount }}
                style={{ 
                  fontSize: '0.85rem', 
                  color: valColor, 
                  fontWeight: 600,
                  textShadow: isLHS ? '0 0 12px rgba(255, 255, 255, 0.4)' : 'none',
                  display: 'inline-block',
                  maxWidth: '100%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {val}
              </motion.span>
            )}
          </AnimatePresence>
          {!hasValue && (
              <span style={{ fontSize: '0.85rem', color: 'transparent' }}>-</span>
          )}
      </div>
    </motion.div>
  );
}
