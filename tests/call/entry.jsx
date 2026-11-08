import React from 'react';
import ReactDOM from 'react-dom/client';
import { FakeAuth } from './authStub.jsx';
import { CallProvider, useCall } from '../../src/contexts/CallContext.jsx';
import ActiveCallScreen from '../../src/components/ActiveCallScreen.jsx';
import { GroupCallProvider, useGroupCall } from '../../src/contexts/GroupCallContext.jsx';
import GroupCallScreen from '../../src/components/GroupCallScreen.jsx';

window.calls = {};
window.groups = {};
window.__pcs = [];
const RealPC = window.RTCPeerConnection;
window.RTCPeerConnection = function (...args) {
  const pc = new RealPC(...args);
  window.__pcs.push(pc);
  return pc;
};
window.RTCPeerConnection.prototype = RealPC.prototype;

function Expose({ name }) {
  window.calls[name] = useCall();
  window.groups[name] = useGroupCall();
  return null;
}

function User({ id, name }) {
  return (
    <FakeAuth value={{ user: { id }, profile: { username: name } }}>
      <CallProvider>
        <GroupCallProvider>
          <Expose name={name} />
          <div data-user={name}>
            <ActiveCallScreen />
            <GroupCallScreen />
          </div>
        </GroupCallProvider>
      </CallProvider>
    </FakeAuth>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <User id="id-alice" name="alice" />
    <User id="id-bob" name="bob" />
    <User id="id-carol" name="carol" />
    <User id="id-dave" name="dave" />
    <User id="id-erin" name="erin" />
    <User id="id-frank" name="frank" />
    <User id="id-gina" name="gina" />
  </>
);
