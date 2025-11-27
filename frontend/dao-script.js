import { createWeb3Modal, defaultConfig } from 'https://esm.sh/@web3modal/ethers@5.0.2'
import { CONTRACTS } from './dao-config.js';

const projectId = '020d84e899581253a188b823482333bc';

const ganache = {
  chainId: 1337,
  name: 'Ganache',
  currency: 'ETH',
  explorerUrl: 'https://etherscan.io',
  rpcUrl: 'http://127.0.0.1:8545'
}

const metadata = {
  name: 'Mi DAO',
  description: 'DAO Dashboard',
  url: window.location.origin,
  icons: ['https://avatars.githubusercontent.com/u/37784886']
}

const modal = createWeb3Modal({
  ethersConfig: defaultConfig({ metadata }),
  chains: [ganache],
  projectId,
  enableAnalytics: false 
})


let provider, signer;
let daoCoreContract, daoDelegationContract, daoTokenContract, daoViewsContract;
let currentAccount;
let contractTokenDecimals = 0;


let DAOCoreABI, DAODelegationABI, DAOTokenABI, DAOViewsABI, SimpleMultiSigABI;


let erc20TokenContract;


const q = id => document.getElementById(id);
const fmtAddr = a => a ? `${a.slice(0,6)}...${a.slice(-4)}` : "-";
const alertErr = e => {
  console.error(e);

  const errorData = e.data || e.error?.data || e.payload?.error?.data || "";

  if (errorData.includes("0xe450d38c")) {
    return showToast("Error: Balance de tokens insuficiente para realizar esta operación.", "danger");
  }
  
  if (errorData.includes("0xfb8f41b2")) {
    return showToast("Error: Permiso (allowance) de tokens insuficiente.", "danger");
  }

  const reason =
    e.reason ||
    e.shortMessage ||
    e.error?.message ||
    e.data?.message ||
    e.message ||
    "Transacción fallida";

  showToast("Error: " + reason.replace("execution reverted: ", ""), "danger");
};


async function safeTx(contract, method, args = []) {
  try {
    try {
      await contract[method].staticCall(...args);
    } catch (err) {
      throw err;
    }

    const tx = await contract[method](...args);
    return await tx.wait();

  } catch (e) {
    alertErr(e);
    throw e;
  }
}

function clearInputs(ids) {
  ids.forEach(id => {
    const el = q(id);
    if (el) el.value = "";
  });
}


function showToast(message, type = "info") {
  const toastId = "toast-" + Date.now();


  const html = `
    <div id="${toastId}" class="toast align-items-center text-white bg-${type} border-0" role="alert">
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto"
                data-bs-dismiss="toast"></button>
      </div>
    </div>
  `;


  const container = document.getElementById("toastContainer");
  container.insertAdjacentHTML("beforeend", html);


  const el = document.getElementById(toastId);
  const toast = new bootstrap.Toast(el);
  toast.show();


  el.addEventListener("hidden.bs.toast", () => el.remove());
}


async function submitMultisigProposal(targetContractAddr, functionFragment, values, isPanic = false) {
  if (!daoCoreContract) return showToast("Conecta tu wallet", "danger");


  try {
    const ownerAddr = await daoCoreContract.owner();
    const panicAddr = await daoCoreContract.panicWallet();
    const multisigAddr = isPanic ? panicAddr : ownerAddr;


    const multisigContract = new ethers.Contract(multisigAddr, SimpleMultiSigABI, signer);


    let targetInterface;


    if (targetContractAddr === await daoCoreContract.getAddress()) {
      targetInterface = daoCoreContract.interface;
    } else if (targetContractAddr === await daoTokenContract.getAddress()) {
      targetInterface = daoTokenContract.interface;
    } else {
      return showToast("Contrato destino desconocido", "danger");
    }


    const data = targetInterface.encodeFunctionData(functionFragment, values);


    await safeTx(multisigContract, "submitTransaction", [
      targetContractAddr,
      0,
      data
    ]);


    showToast("Propuesta de transacción creada en la Multisig. Requiere confirmaciones.", "success");


    await loadMultisigPendingTxs();


  } catch (e) {
    alertErr(e);
  }
}

async function forceTimestampUpdate() {
  // Red real -> enviar transacción dummy
  if (typeof network === "undefined") {
    const tx = await signer.sendTransaction({ to: currentAccount, value: 0n });
    return await tx.wait();
  }

  // Hardhat / Anvil
  try {
    await window.ethereum.request({
      method: "evm_increaseTime",
      params: [10]
    });
    await window.ethereum.request({
      method: "evm_mine"
    });
  } catch (_) {
    await new Promise(r => setTimeout(r, 1500));
  }
}

function modalInput(title, placeholder = "", helpText = "") {
  return new Promise(resolve => {
    document.getElementById("modalInputTitle").textContent = title;
    document.getElementById("modalInputField").value = "";
    document.getElementById("modalInputField").placeholder = placeholder;
    document.getElementById("modalInputHelp").textContent = helpText;


    const modalEl = document.getElementById("modalInput");
    const modal = new bootstrap.Modal(modalEl);


    const okBtn = document.getElementById("modalInputOk");


    const handler = () => {
      okBtn.removeEventListener("click", handler);
      modal.hide();
      resolve(document.getElementById("modalInputField").value);
    };


    okBtn.addEventListener("click", handler);
    modal.show();
  });
}


function modalConfirm(text) {
  return new Promise(resolve => {
    document.getElementById("modalConfirmText").textContent = text;


    const modalEl = document.getElementById("modalConfirm");
    const modal = new bootstrap.Modal(modalEl);


    const okBtn = document.getElementById("modalConfirmOk");


    const handler = () => {
      okBtn.removeEventListener("click", handler);
      modal.hide();
      resolve(true);
    };


    okBtn.addEventListener("click", handler);


    modalEl.addEventListener("hidden.bs.modal", () => resolve(false), { once: true });


    modal.show();
  });
}


const formatTokens = (baseUnits) => {
  const decimals = contractTokenDecimals || 18;
  if (!baseUnits) return "0";
  return ethers.formatUnits(baseUnits, decimals);
};


const parseTokens = (amountStr) => {
  if (!amountStr || amountStr.trim() === "") return 0n;
  try {
    const decimals = contractTokenDecimals || 18;
    return ethers.parseUnits(amountStr, decimals);
  } catch (e) {
    console.error("Error al parsear cantidad de tokens:", e);
    return 0n;
  }
};


const parseWei = (amountStr) => {
  if (!amountStr || amountStr.trim() === "") return 0n;
  try {
    return ethers.parseEther(amountStr);
  } catch (e) {
    console.error("Error al parsear cantidad de Wei:", e);
    return 0n;
  }
};


function safeBigIntFromInput(v) {
  if (v === null || v === undefined || v === "") return 0n;
 
  const str = v.toString(); // convertir a string
 
  if (str.includes(".")) {
    return BigInt(Math.floor(Number(str)));
  }


  return BigInt(str);
}


const setOwnerUIVisible = visible => {
  const ids = [
    "mintAmount", "btnMint",
    "paramPrice", "paramMinVote", "paramMinProp", "paramVotingPeriod",
    "paramTokensPerVP", "paramLockTime", "btnUpdateParams",
    "newOwnerAddr", "btnTransferOwner",
    "panicWalletAddr", "btnSetPanicWallet",
    "btnToggleVotingMode"
  ];
  ids.forEach(id => {
    const el = q(id);
    if (!el) return;
    el.disabled = !visible;
    if (!visible) el.classList.add("opacity-50");
    else el.classList.remove("opacity-50");
  });
};


const setWalletUIVisible = visible => {
  const ids = [
    "propTitle", "propDesc", "propStake", "btnCreateProp",
    "delegateProposalId", "delegateAddress", "delegateAmount", "btnDelegateVote",
    "voteWithDelegationProposalId", "delegatorAddress", "delegatedVoteChoice", "btnVoteWithDelegation",
    "revokeProposalId", "btnRevokeDelegation",
    "buyEth", "btnBuy",
    "unstakeProposalId", "btnUnstake",
    "btnActivatePanic", "btnRestoreNormal"
  ];


  ids.forEach(id => {
    const el = q(id);
    if (!el) return;
    el.disabled = !visible;
  });
};


async function loadABIs() {
  try {
    console.log("Cargando ABIs...");
    const [core, delegation, token, views, multisig] = await Promise.all([
      fetch('./abis/DAOCore.json').then(r => r.json()),
      fetch('./abis/DAODelegation.json').then(r => r.json()),
      fetch('./abis/DAOToken.json').then(r => r.json()),
      fetch('./abis/DAOViews.json').then(r => r.json()),
      fetch('./abis/SimpleMultiSig.json').then(r => r.json())
    ]);


    DAOCoreABI = core;
    DAODelegationABI = delegation;
    DAOTokenABI = token;
    DAOViewsABI = views;
    SimpleMultiSigABI = multisig;


    console.log("ABIs cargados correctamente");
    return true;
  } catch (error) {
    console.error("Error cargando ABIs:", error);


    showToast("Error al cargar los ABIs. Verificá que los archivos existan en ./abis/", "warning");


    return false;
  }
}


async function loadUserBalance() {
  if (!erc20TokenContract || !currentAccount) return;


  const userBalanceEl = q("userBalance");
  if (!userBalanceEl) return;


  try {
    const balance = await erc20TokenContract.balanceOf(currentAccount);
    userBalanceEl.innerText = formatTokens(balance) + " tokens";
  } catch (e) {
    console.error("Error loading user balance:", e);
  }
}


async function loadDAOCurrentParams() {
  if (!daoCoreContract) return;


  try {
    const params = await daoCoreContract.getParams();
    const [price, minVote, minProp, votingPeriod, tokensPerVP, lockTime] = params;


    const formattedPrice = ethers.formatEther(price);
    const formattedMinVote = formatTokens(minVote);
    const formattedMinProp = formatTokens(minProp);
    const formattedTokensPerVP = tokensPerVP.toString();
    const formattedVotingPeriod = votingPeriod.toString();
    const formattedLockTime = lockTime.toString();


    if (q("paramPrice")) q("paramPrice").value = formattedPrice;
    if (q("paramMinVote")) q("paramMinVote").value = formattedMinVote;
    if (q("paramMinProp")) q("paramMinProp").value = formattedMinProp;
    if (q("paramVotingPeriod")) q("paramVotingPeriod").value = formattedVotingPeriod;
    if (q("paramTokensPerVP")) q("paramTokensPerVP").value = formattedTokensPerVP;
    if (q("paramLockTime")) q("paramLockTime").value = formattedLockTime;


    if (q("displayPrice")) q("displayPrice").innerText = formattedPrice;
    if (q("displayMinVote")) q("displayMinVote").innerText = formattedMinVote;
    if (q("displayMinProp")) q("displayMinProp").innerText = formattedMinProp;
    if (q("displayVotingPeriod")) q("displayVotingPeriod").innerText = formattedVotingPeriod;
    if (q("displayTokensPerVP")) q("displayTokensPerVP").innerText = formattedTokensPerVP;
    if (q("displayLockTime")) q("displayLockTime").innerText = formattedLockTime;


  } catch (e) {
    console.error("Error loading DAO parameters:", e);
    if (q("daoParamsDisplay")) q("daoParamsDisplay").innerHTML = "<p>Error al cargar parámetros de la DAO.</p>";
  }
}


async function initDAO() {
  if (!daoCoreContract || !daoViewsContract) return;


  try {
    let multisigAddr = null;
    let isOwner = false;


    try {
      multisigAddr = await daoCoreContract.owner();
    } catch (e) {
      console.warn("No owner() available?", e);
    }


    if (multisigAddr && currentAccount) {
      try {
        const multisig = new ethers.Contract(
          multisigAddr,
          SimpleMultiSigABI,
          signer
        );


        const owners = await multisig.owners();
        isOwner = owners.some(
          o => o.toLowerCase() === currentAccount.toLowerCase()
        );


        console.log("Owners multisig:", owners);
      } catch (err) {
        console.warn("No se pudieron leer owners() del multisig", err);
      }
    }


    setOwnerUIVisible(isOwner);
    setWalletUIVisible(true);


    if (isOwner)
      q("ownerMsg").textContent = `Eres owner del multisig (${fmtAddr(currentAccount)})`;
    else
      q("ownerMsg").textContent = `No sos owner. Algunas acciones están deshabilitadas.`;


    let panicMsg = "";
    let isPanicked = false;


    try {
      isPanicked = await daoCoreContract.isPanicked();
      if (isPanicked) {
        panicMsg += "DAO en modo PÁNICO";


        document.querySelectorAll(
          "button:not(#connectWalletBtn):not(#panic-tab):not(#btnRestoreNormal):not(#panicCard button)"
        ).forEach(b => b.disabled = true);


        q("btnRestoreNormal").disabled = false;
        q("panicMsg").style.display = "block";
        q("votingModeStatus").style.display = "none";
      } else {
        document.querySelectorAll(
          "button:not(#connectWalletBtn):not(#panic-tab):not(#btnRestoreNormal):not(#panicCard button)"
        ).forEach(b => b.disabled = false);


        setWalletUIVisible(true);
        setOwnerUIVisible(isOwner);
        q("panicMsg").style.display = "none";
        q("votingModeStatus").style.display = "block";
      }
    } catch {
      q("panicMsg").style.display = "block";
    }


    if (q("panicMsg")) q("panicMsg").textContent = panicMsg;


    await loadProposals();
    await updateVotingModeUI();
    await loadUserBalance();
    await loadDAOCurrentParams();


  } catch (e) {
    console.error("initDAO error:", e);
  }
}


async function loadProposals() {
  try {
    const proposals = await daoViewsContract.getAllProposals();


    const list = q("proposalsList");
    if (!list) return;
    list.innerHTML = "";


    for (const [idx, p] of proposals.entries()) {
      const id = p.id ?? idx + 1;
      const title = p.title ?? "Sin título";
      const description = p.description ?? "";
      const votesFor = formatTokens(p.votesFor) ?? "0";
      const votesAgainst = formatTokens(p.votesAgainst) ?? "0";
      const status = Number(p.status);
      const statusLabel = ["Activa", "Aprobada", "Rechazada"][status] || status;


      let delegationBadge = "";


      if (currentAccount && daoViewsContract) {
        try {
          const [delegate, amount, active] = await daoViewsContract.getDelegationInfo(
            id,
            currentAccount
          );
          if (active && delegate !== ethers.ZeroAddress) {
            delegationBadge = `<span class="delegation-badge">🤝 Delegado a ${fmtAddr(delegate)}</span>`;
          }
        } catch (e) {
          console.log("No se pudo verificar delegación:", e);
        }
      }


      const el = document.createElement("div");
      el.className = "card mb-3 el-propuesta shadow-sm";
      el.innerHTML = `
        <div class="card-body p-4">


          <div class="d-flex justify-content-between align-items-center">
            <div>
              <h5 class="mb-1 d-flex align-items-center gap-2">
                <b>${title}</b>
                <span class="text-muted small">#${id}</span>
                ${delegationBadge}
              </h5>


              <p class="mt-2 mb-0">
                <span class="fw-bold">Descripción:</span>
                <span class="text-muted">${description}</span>
              </p>
            </div>


            <span class="estado-propuesta bg-${status === 0 ? 'primary' : status === 1 ? 'success' : 'danger'}">
              ${statusLabel}
            </span>
          </div>


          <hr class="my-3">


          <div class="d-flex justify-content-between align-items-center flex-wrap mt-3">


            <div class="d-flex gap-4 flex-wrap">
              <div class="info-box">
                🟩 Votos a favor: <strong>${votesFor}</strong>
              </div>
              <div class="info-box">
                🟥 Votos en contra: <strong>${votesAgainst}</strong>
              </div>
            </div>


            <div class="d-flex gap-2 mt-2 mt-md-0">
              ${
                status === 0
                  ? `
                  <button class="btn btn-sm btn-success" onclick="window.vote(${id}, true)">✅ A favor</button>
                  <button class="btn btn-sm btn-danger" onclick="window.vote(${id}, false)">❌ En contra</button>
                  <button class="btn btn-sm btn-secondary" onclick="window.finalizeProposal(${id})">🏁 Finalizar</button>
                  <button class="btn btn-sm btn-info" onclick="window.showDelegateModal(${id})">🤝 Delegar</button>
                `
                  : ""
              }
            </div>


          </div>
        </div>
      `;
      list.appendChild(el);
    }


  } catch (e) {
    console.error("loadProposals error", e);
  }
}


async function vote(id, inFavor) {
  if (!daoCoreContract || !erc20TokenContract)
    return showToast("Conecta tu wallet y asegúrate de cargar el contrato del token.", "danger");


  try {
    const amountStr = await modalInput("Tokens a stakear", "Ej: 1.5");
    if (!amountStr) return;


    const stake = parseTokens(amountStr);
    if (stake === 0n)
      return showToast("Monto de stake inválido o cero.", "danger");


    const stakingAddr = await daoCoreContract.staking();
    if (!stakingAddr || stakingAddr === ethers.ZeroAddress)
      return showToast("El contrato de Staking no está configurado correctamente.", "danger");


    const confirmApprove = await modalConfirm(
      `Se solicitará aprobación para usar ${amountStr} tokens. ¿Continuar?`
    );
    if (!confirmApprove) return;


    await safeTx(erc20TokenContract, "approve", [stakingAddr, stake]);
    showToast("Aprobación exitosa. Enviando voto...", "info");


    await safeTx(daoCoreContract, "vote", [id, inFavor, stake]);


    showToast("Voto registrado con éxito", "success");
    await loadProposals();
    await loadUserBalance();


  } catch (_) {
  }
}


async function finalizeProposal(id) {
  if (!daoCoreContract)
    return showToast("Conecta tu wallet para finalizar", "danger");

  try {

    await forceTimestampUpdate();

    await safeTx(daoCoreContract, "finalize", [id]);


    showToast("Propuesta finalizada", "success");
    await loadProposals();
    clearInputs(["unstakeProposalId"]);


  } catch (_) {
   
  }
}


function showDelegateModal(proposalId) {
  (async () => {
    const delegateAddr = await modalInput("Dirección del delegado", "0x...");
    if (!delegateAddr) return;


    const amount = await modalInput("Cantidad de tokens a delegar", "Ej: 50");
    if (!amount) return;


    q("delegateProposalId").value = proposalId;
    q("delegateAddress").value = delegateAddr;
    q("delegateAmount").value = amount;


    const delegationTab = document.querySelector('#delegation-tab');
    if (delegationTab) {
      const tab = new bootstrap.Tab(delegationTab);
      tab.show();


      setTimeout(() => {
        q("btnDelegateVote")?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  })();
}


async function delegateVoteQuick(proposalId, delegateAddress, amountStr) {
  if (!daoDelegationContract || !erc20TokenContract)
    return showToast("Conecta tu wallet y asegúrate de cargar el contrato del token.", "danger");


  try {
    const stake = parseTokens(amountStr);
    if (stake === 0n)
      return showToast("Monto de delegación inválido o cero.", "danger");


    const stakingAddr = await daoCoreContract.staking();
    if (!stakingAddr || stakingAddr === ethers.ZeroAddress)
      return showToast("El contrato de Staking no está configurado correctamente.", "danger");


    const confirmApprove = await modalConfirm(
      `Se solicitará aprobación para usar ${amountStr} tokens en la delegación. ¿Continuar?`
    );
    if (!confirmApprove) return;


    showToast("Aprobando tokens...", "info");


    await safeTx(erc20TokenContract, "approve", [stakingAddr, stake]);


    showToast("Aprobación exitosa. Delegando voto...", "info");


    await safeTx(daoDelegationContract, "delegateVote", [
      safeBigIntFromInput(proposalId),
      delegateAddress,
      stake,
    ]);


    showToast("Voto delegado exitosamente", "success");


    await loadProposals();
    await loadUserBalance();


    clearInputs([
      "delegateProposalId",
      "delegateAddress",
      "delegateAmount"
    ]);


  } catch (_) {
  }
}




async function updateVotingModeUI() {
  try {
    const mode = await daoCoreContract.votingMode();
    const text = Number(mode) === 0 ? "Lineal" : "Cuadrático";
    q("votingModeStatus").innerHTML = `<b>Modo actual:</b> ${text}`;
    q("btnToggleVotingMode").textContent = Number(mode) === 0
      ? "Cambiar a Cuadrático"
      : "Cambiar a Lineal";
  } catch {}
}


window.vote = vote;
window.finalizeProposal = finalizeProposal;
window.showDelegateModal = showDelegateModal;


window.showDaoParamsModal = async () => {
  if (!daoCoreContract) {
    q("daoParamsModalBody").innerHTML = "<p>Conecta tu wallet primero.</p>";
  } else {
    await loadDAOCurrentParams();
  }
  const modal = new bootstrap.Modal(q('daoParamsModal'));
  modal.show();
};


async function renderTxsInContainer(msigAddr, containerId, label, badgeClass) {
  const list = document.getElementById(containerId);
  if (!list) return; // Si el contenedor no existe en el HTML, no hacemos nada




  // Si la dirección es 0x0 (no configurada), mostrar aviso
  if (!msigAddr || msigAddr === ethers.ZeroAddress) {
    list.innerHTML = `<div class="alert alert-warning small">⚠️ Wallet de ${label} no configurada.</div>`;
    return;
  }




  list.innerHTML = "<div class='d-flex justify-content-center my-2'><div class='spinner-border spinner-border-sm text-secondary'></div></div>";




  try {
    const msig = new ethers.Contract(msigAddr, SimpleMultiSigABI, provider);
    const count = await msig.transactionCount();
    const req = await msig._requiredConfirmations();
   
    let html = "";
    let hasPending = false;




    // Recorrer transacciones (de la última a la primera)
    for (let i = Number(count) - 1; i >= 0; i--) {
      try {
        const txData = await msig.getTransaction(i);
        const isExecuted = txData[3];
        const currentConfs = txData[4];




        if (isExecuted) continue; // No mostrar ejecutadas
        hasPending = true;




        // Intentar decodificar nombre de la función
        let funcDesc = "Desconocida";
        try {
          let decoded = daoCoreContract.interface.parseTransaction({ data: txData[2] });
          if (!decoded) decoded = daoTokenContract.interface.parseTransaction({ data: txData[2] });
          if (decoded) funcDesc = decoded.name;
        } catch (e) {}




        const canExecute = Number(currentConfs) >= Number(req);




        html += `
          <div class="alert alert-light border shadow-sm mb-2">
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <span class="badge ${badgeClass} mb-1">${label}</span>
                <strong>#${i}: ${funcDesc}</strong>
                <div class="small text-muted mt-1">
                  Confirmaciones: <b>${currentConfs}/${req}</b>
                </div>
              </div>
              <div class="d-flex flex-column gap-1">
                 <button onclick="window.confirmTx('${msigAddr}', ${i})" class="btn btn-sm btn-outline-primary">✍️ Firmar</button>
                 <button onclick="window.executeTx('${msigAddr}', ${i})" class="btn btn-sm btn-success" ${!canExecute ? 'disabled' : ''}>🚀 Ejecutar</button>
              </div>
            </div>
          </div>
        `;
      } catch (err) {
        console.warn(`Error leyendo TX ${i} de ${label}`, err);
      }
    }


    list.innerHTML = hasPending ? html : `<p class="text-muted text-center small my-3">No hay transacciones pendientes en ${label}.</p>`;




  } catch (e) {
    console.error(`Error cargando ${label}:`, e);
    list.innerHTML = `<div class="alert alert-danger small">Error de conexión con el contrato.</div>`;
  }
}


window.loadMultisigPendingTxs = async () => {
  if (!daoCoreContract || !currentAccount) return;




  try {
    const ownerAddr = await daoCoreContract.owner();
    const panicAddr = await daoCoreContract.panicWallet();


    await Promise.all([
      renderTxsInContainer(ownerAddr, "ownerPendingList", "DAO", "bg-primary"),
      renderTxsInContainer(panicAddr, "panicPendingList", "PÁNICO", "bg-danger")
    ]);




  } catch (e) {
    console.error("Error general en multisigs:", e);
  }
};


window.confirmTx = async (msigAddr, id) => {
    try {
        const msig = new ethers.Contract(msigAddr, SimpleMultiSigABI, signer);
        const tx = await msig.confirmTransaction(id);
        showToast("⏳ Confirmando transacción...", "info");
        await tx.wait();
        showToast("✅ Transacción confirmada", "success");
        await loadMultisigPendingTxs();
    } catch(e) { alertErr(e); }
};




window.executeTx = async (msigAddr, id) => {
    try {
        const msig = new ethers.Contract(msigAddr, SimpleMultiSigABI, signer);
       
        const tx = await msig.executeTransaction(id, { gasLimit: 6000000 });
       
        showToast("⏳ Ejecutando transacción final...", "info");
        await tx.wait();
       
        showToast("🚀 ¡Ejecución Exitosa! Actualizando interfaz...", "success");
       
        await loadMultisigPendingTxs();
        await initDAO();                
        await loadDAOCurrentParams();  
        await loadUserBalance();      
        await loadProposals();   
       
    } catch(e) {
        console.error(e);
        alertErr(e);
    }
};


window.addEventListener("DOMContentLoaded", async () => {


  console.log("DOM listo. Cargando ABIs...");


  setOwnerUIVisible(false);
  setWalletUIVisible(false);


  const abisLoaded = await loadABIs();
  if (!abisLoaded) {
    console.error("No se pudieron cargar los ABIs. La aplicación no funcionará correctamente.");
    return;
  }


  console.log("Inicializando listeners...");


q("connectWalletBtn")?.addEventListener("click", async () => {
    try {
      await modal.open();
      
      const walletProvider = modal.getWalletProvider();

      if (!walletProvider) {
          throw new Error("Seleccione una wallet");
      }

      provider = new ethers.BrowserProvider(walletProvider);
      signer = await provider.getSigner();
      currentAccount = await signer.getAddress();

      daoCoreContract = new ethers.Contract(CONTRACTS.daoCore, DAOCoreABI, signer);
      daoDelegationContract = new ethers.Contract(CONTRACTS.daoDelegation, DAODelegationABI, signer);
      daoTokenContract = new ethers.Contract(CONTRACTS.daoToken, DAOTokenABI, signer);
      daoViewsContract = new ethers.Contract(CONTRACTS.daoViews, DAOViewsABI, provider);

      q("connectWalletBtn").textContent = `Conectado: ${fmtAddr(currentAccount)}`;
      q("connectWalletBtn").classList.replace("btn-outline-primary","btn-success");

      try {
        const tokenAddr = await daoCoreContract.token();
        if (tokenAddr !== ethers.ZeroAddress) {
          const ercAbi = [
            "function decimals() view returns (uint8)",
            "function approve(address spender, uint256 amount) returns (bool)",
            "function balanceOf(address account) external view returns (uint256)"
          ];
          erc20TokenContract = new ethers.Contract(tokenAddr, ercAbi, signer);
          contractTokenDecimals = Number(await erc20TokenContract.decimals());
        }
      } catch (e) {
        console.warn("No se pudieron obtener los decimales. Asumiendo 18.", e);
        contractTokenDecimals = 18;
      }

      await initDAO();
      showToast("Wallet conectada exitosamente", "success");

    } catch (e) { 
        console.error(e);
        if (!e.message.includes("User rejected")) {
            showToast(e.message, "info"); 
        }
    }
});


q("btnCreateProp")?.addEventListener("click", async () => {
  if (!daoCoreContract || !erc20TokenContract)
    return showToast("Conecta tu wallet y asegúrate de cargar el contrato del token ERC20.", "danger");


  try {
    const title = q("propTitle").value.trim();
    const desc = q("propDesc").value.trim();
    const stakeStr = q("propStake").value.trim();


    if (!title || !stakeStr)
      return showToast("Título y stake requeridos.", "danger");


    const stake = parseTokens(stakeStr);
    if (stake === 0n)
      return showToast("Monto de stake inválido o cero.", "danger");

    const balance = await erc20TokenContract.balanceOf(currentAccount);
    if (balance < stake) {
        return showToast(`Balance insuficiente. Tienes ${formatTokens(balance)} y necesitas ${stakeStr}.`, "danger");
    }

    const stakingAddr = await daoCoreContract.staking();
    if (!stakingAddr || stakingAddr === ethers.ZeroAddress)
      return showToast("El contrato de Staking no está configurado en el DAOCore", "danger");


    await safeTx(erc20TokenContract, "approve", [stakingAddr, stake]);


    showToast("Aprobación exitosa. Creando propuesta...", "info");


    await safeTx(daoCoreContract, "createProposal", [title, desc, stake]);


    showToast("Propuesta creada", "success");


    clearInputs(["propTitle", "propDesc", "propStake"]);


    await loadProposals();
    await loadUserBalance();


  } catch (_) {
  }
});


q("btnBuy")?.addEventListener("click", async () => {
  if (!daoTokenContract)
    return showToast("Conecta tu wallet para comprar tokens", "danger");


  try {
    const eth = q("buyEth").value;
    if (!eth) return showToast("Ingrese ETH", "danger");


    const value = ethers.parseEther(eth);


    await safeTx(daoTokenContract, "buyTokens", [{ value }]);


    showToast("Tokens comprados", "success");


    await loadUserBalance();
    clearInputs(["buyEth"]);


  } catch (_) {
  }
});


q("btnActivatePanic")?.addEventListener("click", async () => {
  await submitMultisigProposal(
    await daoCoreContract.getAddress(),
    "panic",
    [],
    true // isPanic = true
  );
});




q("btnRestoreNormal")?.addEventListener("click", async () => {
  await submitMultisigProposal(
    await daoCoreContract.getAddress(),
    "tranquility",
    [],
    true // isPanic = true
  );
});


q("btnMint")?.addEventListener("click", async () => {
  const amountStr = q("mintAmount").value;
  if (!amountStr) return showToast("Ingrese amount", "danger");
  const amount = parseTokens(amountStr);
 
  // Llamamos a submitMultisigProposal en vez de daoToken.mintTokens directo
  await submitMultisigProposal(
    await daoTokenContract.getAddress(),
    "mintTokens",
    [amount]
  );
});


q("btnCheckStakes")?.addEventListener("click", async () => {
  if (!daoViewsContract) return showToast("Conecta tu wallet para consultar staking", "danger");


  try {
    const addr = q("addrToCheck").value.trim();
    if (!addr) return showToast("Ingrese una dirección", "danger");


    const balance = await daoViewsContract.getUserTokenBalance(addr);
    const staking = await daoViewsContract.getUserStaking(addr);


    let html = `
      <h5>Balance: ${formatTokens(balance)} tokens</h5>
      <hr>
      <h6>Staking por propuesta:</h6>
    `;


    for (let i = 0; i < staking.proposalIds.length; i++) {
      html += `
        <div class="border p-2 mb-2 rounded">
          <b>Propuesta #${staking.proposalIds[i]}</b><br>
          🟦 Stake de voto: ${formatTokens(staking.voteStakes[i])} tokens<br>
          🟥 Stake de propuesta: ${formatTokens(staking.proposalStakes[i])} tokens
        </div>
      `;
    }


    q("stakesResult").innerHTML = html;


  } catch (e) {
    showToast(e, "danger");
  }
});


  q("btnUpdateParams")?.addEventListener("click", async () => {
    if (!daoCoreContract) return showToast("Conecta tu wallet para actualizar parámetros", "danger");


    try {
      const price = q("paramPrice").value.trim();
      const minVote = q("paramMinVote").value.trim();
      const minProp = q("paramMinProp").value.trim();
      const votingPeriod = q("paramVotingPeriod").value.trim();
      const tokensPerVP = q("paramTokensPerVP").value.trim();
      const lockTime = q("paramLockTime").value.trim();


      if (!price || !minVote || !minProp || !votingPeriod || !tokensPerVP || !lockTime) {
        return showToast("Complete todos los campos de parámetros", "danger");
      }


      const params=  [
        parseWei(price),
        parseTokens(minVote),
        parseTokens(minProp),
        safeBigIntFromInput(votingPeriod),
        safeBigIntFromInput(tokensPerVP),
        safeBigIntFromInput(lockTime)
      ];


      await submitMultisigProposal(
        await daoCoreContract.getAddress(),
        "updateParams",
        params
      );

      await loadDAOCurrentParams();
    } catch (e) {
      alertErr(e);
    }
  });

  q("btnTransferOwner")?.addEventListener("click", async () => {
  if (!daoCoreContract) return showToast("Conecta tu wallet para transferir ownership", "danger");

  try {
    const newOwner = q("newOwnerAddr").value.trim();
    if (!newOwner) return showToast("Ingrese una dirección", "danger");
    const tx = await daoCoreContract.changeOwner(newOwner);
    await tx.wait();
    showToast("Ownership transferido", "success");
    await initDAO();
    clearInputs(["newOwnerAddr"]);
  } catch (e) { alertErr(e); }
});




q("btnSetPanicWallet")?.addEventListener("click", async () => {
  if (!daoCoreContract)
    return showToast("Conecta tu wallet para configurar Panic Wallet", "danger");


  try {
    const wallet = q("panicWalletAddr").value.trim();
    if (!wallet) return showToast("Ingrese una dirección", "danger");


    await submitMultisigProposal(
      await daoCoreContract.getAddress(),
      "setPanicWallet",
      [wallet]
    );


    showToast("Propuesta enviada a la Multisig", "success");
    clearInputs(["panicWalletAddr"]);
    await initDAO();


  } catch (e) {
    alertErr(e);
  }
});




  q("btnUnstake")?.addEventListener("click", async () => {
    if (!daoCoreContract) return showToast("Conecta tu wallet para quitar stake", "danger");


    try {
      const proposalId = q("unstakeProposalId").value.trim();
      if (!proposalId) return showToast("Ingrese un ID de propuesta", "danger");

      await forceTimestampUpdate();
      
      await safeTx(daoCoreContract, "unstakeProposal", [safeBigIntFromInput(proposalId)]);

      showToast("Tokens desbloqueados de la propuesta", "success");
      await loadUserBalance();
      clearInputs(["unstakeProposalId"]);
    } catch (e) {}
  });




  q("btnUnstakeVote")?.addEventListener("click", async () => {
    if (!daoCoreContract) return showToast("Conecta tu wallet para quitar stake", "danger");

    try {
      const proposalId = q("unstakeVoteId").value.trim();
      if (!proposalId) return showToast("Ingrese un ID de propuesta", "danger");

      await forceTimestampUpdate();

      await safeTx(daoCoreContract, "unstakeVote", [safeBigIntFromInput(proposalId)]);


      showToast("Tokens desbloqueados de la propuesta", "success");
      await loadUserBalance();
      await loadProposals();
      clearInputs(["unstakeVoteId"]);
    } catch (e) {}
  });




  q("btnToggleVotingMode")?.addEventListener("click", async () => {
    await submitMultisigProposal(
      await daoCoreContract.getAddress(),
      "toggleVotingMode",
      []
    );
  });

  q("btnDelegateVote")?.addEventListener("click", async () => {
    if (!daoDelegationContract || !erc20TokenContract || !daoCoreContract)
      return showToast("Conecta tu wallet antes de delegar voto", "danger");

    try {
      const proposalId = q("delegateProposalId").value.trim();
      const delegateAddress = q("delegateAddress").value.trim();
      const amountStr = q("delegateAmount").value.trim();

      if (!proposalId || !delegateAddress || !amountStr)
        return showToast("Complete todos los campos de delegación", "danger");

      const stake = parseTokens(amountStr);
      if (stake === 0n)
        return showToast("Monto de delegación inválido o cero.", "danger");

      // --- obtener dirección del staking (igual que quick) ---
      const stakingAddr = await daoCoreContract.staking();
      if (!stakingAddr || stakingAddr === ethers.ZeroAddress)
        return showToast("El contrato de Staking no está configurado correctamente.", "danger");

      // --- confirmación opcional como quick ---
      const confirmApprove = await modalConfirm(
        `Se solicitará aprobación para usar ${amountStr} tokens en la delegación. ¿Continuar?`
      );
      if (!confirmApprove) return;

      // --- aprobación ---
      showToast("Aprobando tokens...", "info");

      await safeTx(erc20TokenContract, "approve", [stakingAddr, stake]);

      showToast("Aprobación exitosa. Delegando voto...", "info");

      // --- delegación ---
      await safeTx(daoDelegationContract, "delegateVote", [
        safeBigIntFromInput(proposalId),
        delegateAddress,
        stake,
      ]);

      showToast("Voto delegado exitosamente", "success");

      // --- refrescar datos ---
      await loadProposals();
      await loadUserBalance();

      clearInputs([
        "delegateProposalId",
        "delegateAddress",
        "delegateAmount"
      ]);

    } catch (e) {
      console.error(e);
      showToast("Error al delegar voto", "danger");
    }
  });



  q("btnVoteWithDelegation")?.addEventListener("click", async () => {
    if (!daoDelegationContract) return showToast("Conecta tu wallet para votar con delegación", "danger");


    try {
      const proposalId = q("voteWithDelegationProposalId").value.trim();
      const delegatorAddr = q("delegatorAddress").value.trim();
      const inFavor = q("delegatedVoteChoice").value === "true";


      if (!proposalId || !delegatorAddr) {
        return showToast("Complete ID de propuesta y Dirección del Delegador", "danger");
      }


      await safeTx(daoDelegationContract, "voteWithDelegation", [
        safeBigIntFromInput(proposalId),
        delegatorAddr,
        inFavor
      ]);


      showToast("Voto con delegación registrado", "success");
      await loadProposals();
      clearInputs(["voteWithDelegationProposalId", "delegatorAddress"]);
    } catch (e) {}
  });




  q("btnRevokeDelegation")?.addEventListener("click", async () => {
    if (!daoDelegationContract) return showToast("Conecta tu wallet para revocar delegación", "danger");


    try {
      const proposalId = q("revokeProposalId").value.trim();
      if (!proposalId) return showToast("Ingrese ID de propuesta", "danger");


      await safeTx(daoDelegationContract, "revokeDelegation", [
        safeBigIntFromInput(proposalId)
      ]);


      showToast("Delegación revocada", "success");
      clearInputs(["revokeProposalId"]);
    } catch (e) {}
  });




  q("btnCheckDelegation")?.addEventListener("click", async () => {
    if (!daoViewsContract) return showToast("Conecta tu wallet para consultar delegación", "danger");


    try {
      const proposalId = q("checkDelegationProposalId").value.trim();
      const addr = q("checkDelegationAddress").value.trim();


      if (!proposalId || !addr) return showToast("Complete todos los campos", "danger");


      const [delegate, amount, active] = await daoViewsContract.getDelegationInfo(
        safeBigIntFromInput(proposalId),
        addr
      );


      const resultDiv = q("delegationResult");


      if (delegate === ethers.ZeroAddress) {
        resultDiv.innerHTML = `
          <div class="alert alert-info">
            <strong>ℹ️ No hay delegación activa</strong><br>
            Esta dirección no ha delegado su voto para esta propuesta.
          </div>`;
      } else {
        resultDiv.innerHTML = `
          <div class="alert alert-${active ? 'success' : 'warning'}">
            <h6><strong>📋 Información de Delegación</strong></h6>
            <hr>
            <p><strong>Delegado:</strong> ${fmtAddr(delegate)}</p>
            <p><strong>Cantidad:</strong> ${formatTokens(amount)} tokens</p>
            <p><strong>Estado:</strong> ${active ? '✅ Activa' : '❌ Inactiva (ya fue usada o revocada)'}</p>
          </div>`;
      }


    } catch (e) {}
  });


  q("filterStatus")?.addEventListener("change", async () => {
    if (!daoViewsContract) return;


    try {
      const filter = q("filterStatus").value;
      const list = q("proposalsList");
      if (!list) return;


      let proposals;


      if (filter === "ALL") {
        proposals = await daoViewsContract.getAllProposals();
      } else {
        const statusMap = { "ACTIVE": 0, "ACCEPTED": 1, "REJECTED": 2 };
        proposals = await daoViewsContract.getProposalsByStatus(statusMap[filter]);
      }


      console.log("Filtro seleccionado:", filter, "→ Recibidas:", proposals);


      list.innerHTML = "";


      for (const [idx, p] of proposals.entries()) {
        const id = p.id ?? idx + 1;
        const title = p.title ?? "Sin título";
        const description = p.description ?? "";
        const votesFor = formatTokens(p.votesFor) ?? "0";
        const votesAgainst = formatTokens(p.votesAgainst) ?? "0";
        const status = Number(p.status);
        const statusLabel = ["Activa", "Aprobada", "Rechazada"][status] || status;


        let delegationBadge = "";
        if (currentAccount && daoViewsContract) {
          try {
            const [delegate, amount, active] =
              await daoViewsContract.getDelegationInfo(id, currentAccount);


            if (active && delegate !== ethers.ZeroAddress) {
              delegationBadge = `<span class="delegation-badge">🤝 Delegado a ${fmtAddr(delegate)}</span>`;
            }
          } catch (e) {
            console.log("Error al verificar delegación:", e);
          }
        }


        const el = document.createElement("div");
        el.className = "card mb-3 el-propuesta shadow-sm";


        el.innerHTML = `
          <div class="card-body p-4">
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <h5 class="mb-1 d-flex align-items-center gap-2">
                  <b>${title}</b>
                  <span class="text-muted small">#${id}</span>
                  ${delegationBadge}
                </h5>


                <p class="mt-2 mb-0">
                  <span class="fw-bold">Descripción:</span>
                  <span class="text-muted">${description}</span>
                </p>
              </div>


              <span class="estado-propuesta bg-${status === 0 ? 'primary' : status === 1 ? 'success' : 'danger'}">
                ${statusLabel}
              </span>
            </div>


            <hr class="my-3">


            <div class="d-flex justify-content-between align-items-center flex-wrap mt-3">
              <div class="d-flex gap-4 flex-wrap">
                <div class="info-box">🟩 Votos a favor: <strong>${votesFor}</strong></div>
                <div class="info-box">🟥 Votos en contra: <strong>${votesAgainst}</strong></div>
              </div>


              <div class="d-flex gap-2 mt-2 mt-md-0">
                ${
                  status === 0
                    ? `
                    <button class="btn btn-sm btn-success" onclick="window.vote(${id}, true)">✅ A favor</button>
                    <button class="btn btn-sm btn-danger" onclick="window.vote(${id}, false)">❌ En contra</button>
                    <button class="btn btn-sm btn-secondary" onclick="window.finalizeProposal(${id})">🏁 Finalizar</button>
                    <button class="btn btn-sm btn-info" onclick="window.showDelegateModal(${id})">🤝 Delegar</button>
                  `
                    : ""
                }
              </div>
            </div>
          </div>
        `;


        list.appendChild(el);
      }
    } catch (e) {
      alertErr(e);
    }
  });


});