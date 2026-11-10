// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import "../interfaces/IControllers.sol";
import "../UtilsLib.sol";

library ControllersLib {
    function linkDidToController(IControllers.Controllers storage cs, string memory did, string memory controller)
        external
        returns (bool)
    {
        uint256 index = cs.didsByController[controller].length;
        cs.didsByController[controller].push(did);
        cs.didsByControllerIndex[controller][did] = index;
        return true;
    }

    function unlinkDidFromController(IControllers.Controllers storage cs, string memory did, string memory controller)
        external
        returns (bool)
    {
        string[] storage dids = cs.didsByController[controller];
        uint256 index = cs.didsByControllerIndex[controller][did];

        if (UtilsLib.equalStrings(dids[index], did)) {
            // correct index
            dids[index] = dids[dids.length - 1];
            // remap index
            cs.didsByControllerIndex[controller][did] = 0;
            cs.didsByControllerIndex[controller][dids[index]] = index;
            dids.pop();
        }
        return true;
    }
}
